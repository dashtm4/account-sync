import axios from 'axios';
import moment from 'moment';
import AWS from 'aws-sdk';
import Boom from '@hapi/boom';
import OAuthClient from 'intuit-oauth';
import middy from 'middy';
import { v4 as uuid4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import { APIGatewayEvent, GetReportEvent, SuccessReportStoreResponse } from '../types/aws';
import {
    QBTrialBalanceReport, InternalTrialBalanceReport,
    Account, AccountInfoResponse,
} from '../types/reports';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { compareAccounts } from '../utils/compareAccounts';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const instance = axios.create({
    baseURL: process.env.intuitAPI!,
});

const getNewToken = async (refreshToken: string): Promise<string[]> => {
    const authResponse = await oauthClient.refreshUsingToken(refreshToken);

    const tokens = authResponse.getToken();

    return [tokens.access_token, tokens.refresh_token];
};

const getAccountsInfo = async (
    realmId: string,
    accessToken: string,
    ids: String[]): Promise<AccountInfoResponse> => {
    const accountInfo = await instance.get<AccountInfoResponse>(`company/${realmId}/query`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
        params: {
            query: `select * from Account where Id in ('${ids.join("','")}')`,
        },
    });

    return accountInfo.data;
};

const getReport = async (realmId: string, accessToken: string, endPeriod: Date, accountingMethod: string) => {
    if (!accountingMethod){
        accountingMethod = "Accrual";
    }
    const trialBalanceReport = await instance.get<QBTrialBalanceReport>(`company/${realmId}/reports/TrialBalance`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
        params: {
            end_date: moment(endPeriod).format('YYYY-MM-DD'),
            start_date: moment(endPeriod).subtract(1, 'years').format('YYYY-MM-DD'),
            accounting_method: accountingMethod,
        },
    });

    return trialBalanceReport.data;
};

export const getDeleteAccounts = (
    dbAccounts: AWS.DynamoDB.DocumentClient.ItemList,
    newAccounts: Account[],
) => {
    const deleteAccounts = Array<Account>();
    dbAccounts.forEach((account) => {
        var found = false;
        newAccounts.forEach((newAccount) => {
            if (account.QboID === newAccount.QboId) {
                // eslint-disable-next-line no-param-reassign
                found = true;
            }
        });
        if (found == false){
            deleteAccounts.push(account.Id);
        }
    });

    return deleteAccounts;
};

const processReport = (trialBalanceReport: QBTrialBalanceReport): InternalTrialBalanceReport => {
    const accounts: Account[] = [];

    const Total: {
        DebitCents: number,
        CreditCents: number,
    } = {
        DebitCents: 0,
        CreditCents: 0,
    };

    const { Row } = trialBalanceReport.Rows;

    // eslint-disable-next-line no-restricted-syntax
    for (const row of Row ?? []) {
        if (row.Summary) {
            Total.DebitCents = +row.Summary.ColData[1].value;
            Total.CreditCents = +row.Summary.ColData[2].value;
            // eslint-disable-next-line no-continue
            continue;
        }
        // eslint-disable-next-line no-continue
        if (!row.ColData) continue;
        const AccountName = row.ColData[0].value;
        const QboId = row.ColData[0].id!;
        const ValueCents = row.ColData[1].value ? +row.ColData[1].value
            : -+row.ColData[2].value;
        const Type = row.ColData[1].value ? 'Debit' : 'Credit';

        accounts.push({
            AccountName: AccountName, 
            QboId: QboId,
            Id: uuid4(),
            ValueCents: ValueCents, 
            Type: Type, 
        });
    }

    const {
        Time: CreatedAt, StartPeriod, EndPeriod, ReportBasis,
    } = trialBalanceReport.Header;

    const processedReport = {
        Id: uuid4(), CreatedAt, StartPeriod, EndPeriod, ReportBasis, Accounts: accounts, Total,
    };

    return processedReport;
};

const addAcctInfo = (
    accountInfo: AccountInfoResponse,
    processedReport: InternalTrialBalanceReport,
) => {
    processedReport.Accounts.forEach((account) => {
        accountInfo.QueryResponse.Account.forEach((accInfo) => {
            if (account.QboId === accInfo.Id) {
                account.AcctNum = accInfo.AcctNum;
                account.Description = accInfo.Description;
            }
        });
    });
    return processedReport;
};

const getAndProcessReport = async (realmId: string,
    endPeriod: Date, accountingMethod: string, Items: AWS.DynamoDB.DocumentClient.ItemList) => {
    let report: QBTrialBalanceReport;
    let error: boolean = false;

    let tokens = [Items[0].AccessToken, Items[0].RefreshToken];

    try {
        report = await getReport(realmId, tokens[0], endPeriod, accountingMethod);
    } catch (e) {
        if (e.response && e.response.status === 401) {
            // eslint-disable-next-line no-console
            console.log('Token expired');
            error = true;
        } else throw Boom.internal('Something happened', e);
    }

    if (error) {
        try {
            tokens = await getNewToken(Items[0].RefreshToken);
        } catch (e) {
            throw Boom.expectationFailed('Refresh token expired');
        }
        var clientId = ""
        if (Items[0].Id){
            clientId = Items[0].Id;
        }{
            clientId = uuid4();
        }
        await dynamoDb.update({
            TableName: process.env.clientsTable!,
            Key: { Id: clientId},
            UpdateExpression: 'set #atoken = :t1, #rtoken = :t2',
            ExpressionAttributeNames: {
                '#atoken': 'AccessToken',
                '#rtoken': 'RefreshToken',
            },
            ExpressionAttributeValues: {
                ':t1': tokens[0],
                ':t2': tokens[1],
            },
        }).promise();
    }

    report = await getReport(realmId, tokens[0], endPeriod, accountingMethod);

    const processedReport = processReport(report);

    const qboIds = processedReport.Accounts.map((account) => account.Id);

    if(qboIds.length > 0){
        const accountsInfo = await getAccountsInfo(realmId, tokens[0], qboIds);
        return addAcctInfo(accountsInfo, processedReport);
    }else{
        return processedReport
    }
};

const storeReportSettings = async (
    entityType: string,
    clientId: string,
    companyName: string,
    cognitoId: string,
    {
        reportType,
        software,
        endDate,
        accountingMethod,
    }: {
        reportType: string;
        software: string;
        endDate: Date;
        accountingMethod: string;
    }) => {
    const params = {
        TableName: process.env.reportsTable!,
        Item: {
            Id: uuid4(),
            CompanyName: companyName,
            CognitoId: cognitoId,
            ClientId: clientId,
            ReportType: reportType,
            Software: software,
            AccountingMethod: accountingMethod,
            EndDate: moment(endDate).format('YYYY-MM-DD'),
            EntityType: entityType,
        },
    };

    try {
        await dynamoDb.put(params).promise();
        return params.Item.Id;
    } catch (e) {
        throw Boom.internal('Error during insert to db', e);
    }
};

const updateReportSettings = async (
    id: string,
    {
        reportType,
        software,
        endDate,
        accountingMethod,
    }: {
        reportType: string;
        software: string;
        endDate: Date;
        accountingMethod: string;
    }) => {
    await dynamoDb.update({
        TableName: process.env.reportsTable!,
        Key: { Id: id },
        UpdateExpression: 'set #d = :endDate, #s = :software, #r = :reportType, #u = :downloadUrl, #aM = :accountingMethod',
        ExpressionAttributeNames: {
            '#d': 'EndDate',
            '#s': 'Software',
            '#r': 'ReportType',
            '#u': 'DownloadUrl',
            '#aM': 'AccountingMethod',
        },
        ExpressionAttributeValues: {
            ':endDate': moment(endDate).format('YYYY-MM-DD'),
            ':software': software,
            ':reportType': reportType,
            ':accountingMethod': accountingMethod,
            ':downloadUrl': '',
        },
    }).promise();
    return id;
};

const storeProcessedReport = async (proccessedReport: InternalTrialBalanceReport, id: string) => {
    const params = {
        TableName: process.env.reportsTable!,
        Key: { Id: id },
        UpdateExpression: 'set #sPeriod = :startPeriod, #ePeriod = :endPeriod, #cAt = :createdAt, #rBase = :repBasis, #t = :total',
        ExpressionAttributeNames: {
            '#sPeriod': 'StartPeriod',
            '#ePeriod': 'EndPeriod',
            '#cAt': 'CreatedAt',
            '#rBase': 'ReportBasis',
            '#t': 'Total',
        },
        ExpressionAttributeValues: {
            ':startPeriod': proccessedReport.StartPeriod,
            ':endPeriod': proccessedReport.EndPeriod,
            ':createdAt': proccessedReport.CreatedAt,
            ':repBasis': proccessedReport.ReportBasis,
            ':total': proccessedReport.Total,
        },
    };
    await dynamoDb.update(params).promise();
};

const getDeprecatedAccounts = async (reportId: string) => {
    const { Items: accountsToUpdate } = await dynamoDb.scan({
        TableName: process.env.accountsTable!,
        FilterExpression: 'ReportId = :reportId',
        ExpressionAttributeValues: {
            ':reportId': reportId,
        },
    }).promise();

    return accountsToUpdate;
};

const updateAccounts = async (updatedAccounts: AWS.DynamoDB.DocumentClient.ItemList) => {
    const updateItems = [];

    if (updatedAccounts.length) {
        // eslint-disable-next-line no-restricted-syntax
        for (const account of updatedAccounts) {
            console.log("Updating Account...");
            console.log(JSON.stringify(account));
            await dynamoDb.put({
                TableName: process.env.accountsTable!,
                Item: account,
            }).promise();
        }
    }
};

const deleteAccounts = async (deleteAccounts: Account[]) => {
    const updateItems = [];
    if (deleteAccounts.length) {
        // eslint-disable-next-line no-restricted-syntax
        for (const account of deleteAccounts) {
            const item = {
                DeleteRequest: {
                    Key: {
                      "Id": account
                    },
                },
            };
            updateItems.push(item);
        }
        if (updateItems.length > 0){
            await dynamoDb.batchWrite({
                RequestItems: {
                    [process.env.accountsTable!]: [...updateItems],
                },
            }).promise();
        }
    }
};


const storeAccounts = async (accounts: Account[], reportId: string) => {
    const items = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const account of accounts) {
        const item = {
            PutRequest: {
                // eslint-disable-next-line prefer-object-spread
                Item: Object.assign({}, account, {
                    Id: uuid4(),
                    ReportId: reportId,
                }),
            },
        };
        items.push(item);
    }

    const params = {
        RequestItems: {
            [process.env.accountsTable!]: [...items],
        },
    };
    await dynamoDb.batchWrite(params).promise();
};

const checkAvailableSettings = async (clientId: string) => {
    const { Items: reports } = await dynamoDb.scan({
        TableName: process.env.reportsTable!,
        FilterExpression: 'ClientId = :clientId',
        ExpressionAttributeValues: {
            ':clientId': clientId,
        },
    }).promise();

    if (reports) {
        return reports[0];
    }

    return undefined;
};

const getCompanyName = async(clientId: string) =>{
    const { Item } = await dynamoDb.get({
        TableName: process.env.clientsTable!,
        Key: { Id: clientId },
    }).promise();
    if (Item) {
        return(Item.CompanyName);
    }else{
        return undefined;
    }
}

const rawHandler = async (
    event: APIGatewayEvent<GetReportEvent>,
): Promise<APIGatewayResponse<SuccessReportStoreResponse>> => {
    let reportId: string;

    const { companySettings, entityType } = event.body;

    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const { Items } = await dynamoDb.scan({
        TableName: process.env.clientsTable!,
        FilterExpression: 'RealmId = :realmId and CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':realmId': event.pathParameters.realmId,
            ':cognitoId': cognitoId,
        },
    }).promise();

    if (Items) {
        const reportCheck = await checkAvailableSettings(Items[0].Id);
        const companyName = await getCompanyName(Items[0].Id);
        reportId = reportCheck
            ? await updateReportSettings(reportCheck.Id, companySettings)
            : await storeReportSettings(entityType, Items[0].Id, companyName, cognitoId, companySettings);
    } else throw Boom.badRequest('Client with this Id was not found');

    const processedReport = await getAndProcessReport(Items[0].RealmId,
        companySettings.endDate, companySettings.accountingMethod, Items);

    await storeProcessedReport(processedReport, reportId);

    const accounts = processedReport.Accounts;

    const accountsToUpdate = await getDeprecatedAccounts(reportId);

    if (accountsToUpdate?.length) {
        const updatedAccounts = compareAccounts(accountsToUpdate, accounts);

        const toBeDeletedAccounts = getDeleteAccounts(accountsToUpdate, accounts);

        while (updatedAccounts?.length) {
            // eslint-disable-next-line no-await-in-loop
            await updateAccounts(updatedAccounts.splice(0, 25));
        }

        while (toBeDeletedAccounts?.length){
            await deleteAccounts(toBeDeletedAccounts.splice(0,25))
        }

        return { message: 'Report successfully stored in db', id: reportId };
    }

    while (accounts.length) {
        // eslint-disable-next-line no-await-in-loop
        await storeAccounts(accounts.splice(0, 25), reportId);
    }

    return { message: 'Report successfully stored in db', id: reportId };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<GetReportEvent>,
    APIGatewayResponse<SuccessReportStoreResponse>>());

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

const getReport = async (realmId: string, accessToken: string, endPeriod: Date) => {
    const trialBalanceReport = await instance.get<QBTrialBalanceReport>(`company/${realmId}/reports/TrialBalance`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
        params: {
            end_date: endPeriod,
        },
    });

    return trialBalanceReport.data;
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
        const Id = row.ColData[0].id!;
        const ValueCents = row.ColData[1].value ? +row.ColData[1].value
            : -+row.ColData[2].value;
        const Type = row.ColData[1].value ? 'Debit' : 'Credit';

        accounts.push({
            AccountName, Id, ValueCents, Type,
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

const addAcctNumber = (
    accountInfo: AccountInfoResponse,
    processedReport: InternalTrialBalanceReport,
) => {
    processedReport.Accounts.forEach((account) => {
        accountInfo.QueryResponse.Account.forEach((accInfo) => {
            if (account.Id === accInfo.Id && accInfo.AcctNumber) {
                // eslint-disable-next-line no-param-reassign
                account.AcctNumber = accInfo.AcctNumber;
            }
        });
    });
    return processedReport;
};

const getAndProcessReport = async (realmId: string,
    endPeriod: Date, Items: AWS.DynamoDB.DocumentClient.ItemList) => {
    let report: QBTrialBalanceReport;
    let error: boolean = false;

    let tokens = [Items[0].AccessToken, Items[0].RefreshToken];

    try {
        report = await getReport(realmId, tokens[0], endPeriod);
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

        await dynamoDb.update({
            TableName: process.env.clientsTable!,
            Key: { Id: Items[0].Id },
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

    report = await getReport(realmId, tokens[0], endPeriod);

    const processedReport = processReport(report);

    const ids = processedReport.Accounts.map((account) => account.Id);

    const accountsInfo = await getAccountsInfo(realmId, tokens[0], ids);

    return addAcctNumber(accountsInfo, processedReport);
};

const storeReportSettings = async (
    entityType: string,
    clientId: string,
    {
        reportType,
        software,
        endDate,
    }: {
        reportType: string;
        software: string;
        endDate: Date;
    }) => {
    const params = {
        TableName: process.env.reportsTable!,
        Item: {
            Id: uuid4(),
            ClientId: clientId,
            ReportType: reportType,
            Software: software,
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
    }: {
        reportType: string;
        software: string;
        endDate: Date;
    }) => {
    await dynamoDb.update({
        TableName: process.env.reportsTable!,
        Key: { Id: id },
        UpdateExpression: 'set #d = :endDate, #s = :software, #r = :reportType, #u = :downloadUrl',
        ExpressionAttributeNames: {
            '#d': 'EndDate',
            '#s': 'Software',
            '#r': 'ReportType',
            '#u': 'DownloadUrl',
        },
        ExpressionAttributeValues: {
            ':endDate': moment(endDate).format('YYYY-MM-DD'),
            ':software': software,
            ':reportType': reportType,
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
            const item = {
                PutRequest: {
                    Item: {
                        ...account,
                    },
                },
            };
            updateItems.push(item);
        }
        await dynamoDb.batchWrite({
            RequestItems: {
                [process.env.accountsTable!]: [...updateItems],
            },
        }).promise();
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

        reportId = reportCheck
            ? await updateReportSettings(reportCheck.Id, companySettings)
            : await storeReportSettings(entityType, Items[0].Id, companySettings);
    } else throw Boom.badRequest('Client with this Id was not found');

    const processedReport = await getAndProcessReport(Items[0].RealmId,
        companySettings.endDate, Items);

    await storeProcessedReport(processedReport, reportId);

    const accounts = processedReport.Accounts;

    const accountsToUpdate = await getDeprecatedAccounts(reportId);

    if (accountsToUpdate?.length) {
        const updatedAccounts = compareAccounts(accountsToUpdate, accounts);

        while (updatedAccounts?.length) {
            // eslint-disable-next-line no-await-in-loop
            await updateAccounts(updatedAccounts.splice(0, 25));
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
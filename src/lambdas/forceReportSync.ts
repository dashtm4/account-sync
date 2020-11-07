import moment from 'moment';
import AWS from 'aws-sdk';
import Boom from '@hapi/boom';
import middy from 'middy';
import { v4 as uuid4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import { APIGatewayEvent, SyncReportEvent, SuccessReportStoreResponse } from '../types/aws';
import {
    QBTrialBalanceReport, InternalTrialBalanceReport,
    Account, AccountInfoResponse,
} from '../types/reports';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { compareAccounts } from '../utils/compareAccounts';
import {getNewToken, getAccountsInfo, getReport} from '../utils/qbo_sync_utils';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

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
        return await processReportWithAccounts(report, realmId, tokens[0]);  
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
        const clientId = Items[0].Id;

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

        report = await getReport(realmId, tokens[0], endPeriod, accountingMethod);
        return await processReportWithAccounts(report, realmId, tokens[0]);        
    }
    return undefined;
};

const processReportWithAccounts = async (trialBalanceReport: QBTrialBalanceReport, realmId: string, token: string) => {
    const processedReport = processReport(trialBalanceReport);

    const qboIds = processedReport.Accounts.map((account) => account.QboId);

    if(qboIds.length > 0){
        const accountsInfo = await getAccountsInfo(realmId, token, qboIds);
        return addAcctInfo(accountsInfo, processedReport);
    }else{
        return processedReport
    }
}



const storeProcessedReport = async (proccessedReport: InternalTrialBalanceReport, id: string) => {
    const params = {
        TableName: process.env.reportsTable!,
        Key: { Id: id },
        UpdateExpression: 'set #sPeriod = :startPeriod, #ePeriod = :endPeriod, #cAt = :createdAt, #rBase = :repBasis, #t = :total, #lU = :lastUpdated',
        ExpressionAttributeNames: {
            '#sPeriod': 'StartPeriod',
            '#ePeriod': 'EndPeriod',
            '#cAt': 'CreatedAt',
            '#rBase': 'ReportBasis',
            '#t': 'Total',
            '#lU': 'LastUpdated',
        },
        ExpressionAttributeValues: {
            ':startPeriod': proccessedReport.StartPeriod,
            ':endPeriod': proccessedReport.EndPeriod,
            ':createdAt': proccessedReport.CreatedAt,
            ':repBasis': proccessedReport.ReportBasis,
            ':total': proccessedReport.Total,
            ':lastUpdated': moment().format('MMMM Do YYYY, h:mm:ss a'),
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

const getReportSettings = async (clientId: string) => {
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
    event: APIGatewayEvent<SyncReportEvent>,
): Promise<APIGatewayResponse<SuccessReportStoreResponse>> => {

    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const { Items } = await dynamoDb.scan({
        TableName: process.env.clientsTable!,
        FilterExpression: 'Id = :clientId and CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':clientId': event.pathParameters.clientId,
            ':cognitoId': cognitoId,
        },
    }).promise();

    if (Items && Items.length > 0) {
        
    } else throw Boom.badRequest('Client with this Id was not found');

    const reportSettings = await getReportSettings(Items[0].Id);
    if(reportSettings){
        const processedReport = await getAndProcessReport(Items[0].RealmId,
            reportSettings.endDate, reportSettings.accountingMethod, Items);
        if (processedReport){
            await storeProcessedReport(processedReport, reportSettings.Id);
            const accounts = processedReport.Accounts;
            const accountsToUpdate = await getDeprecatedAccounts(reportSettings.Id);

            if (accountsToUpdate && accountsToUpdate.length) {
                const updatedAccounts = compareAccounts(accountsToUpdate, accounts);
        
                const toBeDeletedAccounts = getDeleteAccounts(accountsToUpdate, accounts);
        
                while (updatedAccounts?.length) {
                    // eslint-disable-next-line no-await-in-loop
                    await updateAccounts(updatedAccounts.splice(0, 25));
                }
        
                while (toBeDeletedAccounts?.length){
                    await deleteAccounts(toBeDeletedAccounts.splice(0,25))
                }
            }
        
            while (accounts.length) {
                // eslint-disable-next-line no-await-in-loop
                await storeAccounts(accounts.splice(0, 25), reportSettings.Id);
            }
        
            return { message: 'Report Updated', id: reportSettings.Id };
        }else{
            throw Boom.internal('Error Processing Report');
        }
    } else throw Boom.badRequest('No Report was not found');
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<SyncReportEvent>,
    APIGatewayResponse<SuccessReportStoreResponse>>());

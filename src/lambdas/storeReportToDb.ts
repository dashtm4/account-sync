import axios from 'axios';
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

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const instance = axios.create({
    baseURL: 'https://sandbox-quickbooks.api.intuit.com/v3/',
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
    // const startPeriod = moment(endPeriod, dateFormat).startOf('M').format(dateFormat);

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
        tokens = await getNewToken(Items[0].RefreshToken);

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
        taxSoftware,
        endPeriod,
    }: {
        reportType: string;
        taxSoftware: string;
        endPeriod: Date;
    }) => {
    const params = {
        TableName: process.env.reportsTable!,
        Item: {
            Id: uuid4(),
            ClientId: clientId,
            ReportType: reportType,
            Software: taxSoftware,
            EndDate: endPeriod,
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

const storeProcessedReport = async (proccessedReport: InternalTrialBalanceReport, id: string) => {
    const params = {
        TableName: process.env.reportsTable!,
        Key: { Id: id },
        UpdateExpression: 'set #a = :accs',
        ExpressionAttributeNames: {
            '#a': 'Accounts',
        },
        ExpressionAttributeValues: {
            ':accs': proccessedReport,
        },
    };

    await dynamoDb.update(params).promise();
};

const rawHandler = async (
    event: APIGatewayEvent<GetReportEvent>,
): Promise<APIGatewayResponse<SuccessReportStoreResponse>> => {
    // const { sub: cognitoId } = event.requestContext.authorizer.claims;
    let reportId: string;

    const { companySettings, entityType } = event.body;

    const { Items } = await dynamoDb.scan({
        TableName: process.env.clientsTable!,
        FilterExpression: 'RealmId = :realmId',
        ExpressionAttributeValues: { ':realmId': event.pathParameters.realmId },
    }).promise();

    if (Items) {
        reportId = await storeReportSettings(entityType, Items[0].Id, companySettings);
    } else throw Boom.badRequest('Client with this Id was not found');

    const processedReport = await getAndProcessReport(Items[0].RealmId,
        companySettings.endPeriod, Items);

    await storeProcessedReport(processedReport, reportId);

    return { message: 'Report successfully stored in db', id: reportId };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<GetReportEvent>,
    APIGatewayResponse<SuccessReportStoreResponse>>());

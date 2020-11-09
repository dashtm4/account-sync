import moment from 'moment';
import OAuthClient from 'intuit-oauth';
import axios from 'axios';
import {
    QBTrialBalanceReport,  AccountInfoResponse, Account, InternalTrialBalanceReport,
} from '../types/reports';
import { v4 as uuid4 } from 'uuid';
import AWS from 'aws-sdk';


const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const instance = axios.create({
    baseURL: process.env.intuitAPI!,
});

export const getNewToken = async (refreshToken: string): Promise<string[]> => {
    const authResponse = await oauthClient.refreshUsingToken(refreshToken);

    const tokens = authResponse.getToken();

    return [tokens.access_token, tokens.refresh_token];
};

export const getAccountsInfo = async (
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

export const getReport = async (realmId: string, accessToken: string, endPeriod: Date, accountingMethod: string) => {
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

export const addAcctInfo = (
    accountInfo: AccountInfoResponse,
    processedReport: InternalTrialBalanceReport,
) => {
    processedReport.Accounts.forEach((account) => {
        accountInfo.QueryResponse.Account.forEach((accInfo) => {
            if (account.QboId === accInfo.Id) {
                account.AcctNum = accInfo.AcctNum;
                account.AccountName = accInfo.Name;
                account.FullyQualifiedName = accInfo.FullyQualifiedName;
                account.Description = accInfo.Description;
                if (accInfo.ParentRef && accInfo.ParentRef.value){
                    account.ParentQboId = accInfo.ParentRef.value;
                }
            }
        });
    });
    return processedReport;
};

export const processReport = (trialBalanceReport: QBTrialBalanceReport): InternalTrialBalanceReport => {
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
            ParentQboId: "",
            FullyQualifiedName: "",
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

export const getDeleteAccounts = (
    dbAccounts: AWS.DynamoDB.DocumentClient.ItemList,
    newAccounts: Account[],
) => {
    const deleteAccounts = Array<Account>();
    dbAccounts.forEach((account) => {
        var found = false;
        console.log("looking for account " + account.Id);
        newAccounts.forEach((newAccount) => {
            console.log("checking against newAccount....");
            console.log(JSON.stringify(newAccount));
            if (account.Id === newAccount.Id) {
                // eslint-disable-next-line no-param-reassign
                found = true;
                console.log('Found Account ' + account.Id);
            }
        });
        if (found == false){
            console.log('Adding account to be deleted ' + account.Id);
            deleteAccounts.push(account.Id);
        }
    });

    return deleteAccounts;
};

export const storeProcessedReport = async (proccessedReport: InternalTrialBalanceReport, id: string, dynamoDb: AWS.DynamoDB.DocumentClient) => {
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

export const getDeprecatedAccounts = async (reportId: string, dynamoDb: AWS.DynamoDB.DocumentClient) => {
    const { Items: accountsToUpdate } = await dynamoDb.scan({
        TableName: process.env.accountsTable!,
        FilterExpression: 'ReportId = :reportId',
        ExpressionAttributeValues: {
            ':reportId': reportId,
        },
    }).promise();

    return accountsToUpdate;
};

export const updateAccounts = async (updatedAccounts: AWS.DynamoDB.DocumentClient.ItemList, dynamoDb: AWS.DynamoDB.DocumentClient) => {
    const updateItems = [];

    if (updatedAccounts.length) {
        // eslint-disable-next-line no-restricted-syntax
        for (const account of updatedAccounts) {
            await dynamoDb.put({
                TableName: process.env.accountsTable!,
                Item: account,
            }).promise();
        }
    }
};

export const deleteAccounts = async (deleteAccounts: Account[],dynamoDb: AWS.DynamoDB.DocumentClient) => {
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

export const storeAccounts = async (accounts: Account[], reportId: string, dynamoDb: AWS.DynamoDB.DocumentClient) => {
    const items = [];
    console.log("Storing Accounts with ReportId: " + reportId);

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
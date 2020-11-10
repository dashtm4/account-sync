import moment from 'moment';
import AWS from 'aws-sdk';
import Boom from '@hapi/boom';
import middy from 'middy';
import { v4 as uuid4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import { APIGatewayEvent, GetReportEvent, SuccessReportStoreResponse } from '../types/aws';
import {
    QBTrialBalanceReport, 
    Account
} from '../types/reports';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { compareAccounts } from '../utils/compareAccounts';
import {getNewToken, getAccountsInfo, getReport, 
    addAcctInfo, processReport, getDeleteAccounts, 
    storeProcessedReport,getDeprecatedAccounts, updateAccounts,
    deleteAccounts, storeAccounts} from '../utils/qbo_sync_utils';


const dynamoDb = new AWS.DynamoDB.DocumentClient();

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

    const qboIds = processedReport.Accounts.map((account) => account.QboId);

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
        autoMap,
    }: {
        reportType: string;
        software: string;
        endDate: Date;
        accountingMethod: string;
        autoMap: boolean;
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
            AutoMap: autoMap,
            LastUpdated: moment().format('MMMM Do YYYY, h:mm:ss a'),
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
        autoMap,
    }: {
        reportType: string;
        software: string;
        endDate: Date;
        accountingMethod: string;
        autoMap: boolean;
    }) => {
    await dynamoDb.update({
        TableName: process.env.reportsTable!,
        Key: { Id: id },
        UpdateExpression: 'set #d = :endDate, #s = :software, #r = :reportType, #u = :downloadUrl, #aM = :accountingMethod, #autoMap = :autoMap, #lU = :lastUpdated',
        ExpressionAttributeNames: {
            '#d': 'EndDate',
            '#s': 'Software',
            '#r': 'ReportType',
            '#u': 'DownloadUrl',
            '#aM': 'AccountingMethod',
            '#lU': 'LastUpdated',
            '#autoMap': 'AutoMap',
        },
        ExpressionAttributeValues: {
            ':endDate': moment(endDate).format('YYYY-MM-DD'),
            ':software': software,
            ':reportType': reportType,
            ':accountingMethod': accountingMethod,
            ':lastUpdated': moment().format('MMMM Do YYYY, h:mm:ss a'),
            ':downloadUrl': '',
            ':autoMap': autoMap,
        },
    }).promise();
    return id;
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

const autoMapAccounts = async(accounts: Account[], cognitoId: string, entityType: string) => {
    const { Items: existingAccounts } = await dynamoDb.query({
        TableName: process.env.accountsTable!,
        IndexName: 'CognitoIdByEntityType',
        KeyConditionExpression: 'CognitoId = :cognitoId AND EntityType = :entityType',
        ExpressionAttributeValues: {
            ':cognitoId': cognitoId,
            ':entityType': entityType,
        },
    }).promise();
    if (existingAccounts){
        var autoMappedAccounts = [];
        for(const a of accounts){
            var found_account = false;
            for (const e of existingAccounts){
                if (a.AccountName == e.AccountName && a.AcctNum == e.AcctNum){
                    a.TaxCode = e.TaxCode;
                    a.TaxCodeDescription = e.TaxCodeDescription;
                    a.Toggle = e.Toggle;
                    autoMappedAccounts.push(a);
                    found_account = true;
                    break;
                }
            }
            if (found_account == false){
                autoMappedAccounts.push(a);
            }
        }
        return autoMappedAccounts;
    }
    return accounts;

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

    await storeProcessedReport(processedReport, reportId, dynamoDb);

    var accounts = processedReport.Accounts;

    const accountsToUpdate = await getDeprecatedAccounts(reportId, dynamoDb);

    if (accountsToUpdate && accountsToUpdate.length) {
        var updatedAccounts = compareAccounts(accountsToUpdate, accounts);

        const toBeDeletedAccounts = getDeleteAccounts(accountsToUpdate, accounts);

        while (updatedAccounts?.length) {
            // eslint-disable-next-line no-await-in-loop
            await updateAccounts(updatedAccounts.splice(0, 25), dynamoDb, cognitoId, entityType);
        }

        while (toBeDeletedAccounts?.length){
            await deleteAccounts(toBeDeletedAccounts.splice(0,25), dynamoDb)
        }

        return { message: 'Report successfully stored in db', id: reportId };
    }

    if (companySettings.autoMap == true){
        console.log("Running automap... setting is true");
        accounts = await autoMapAccounts(accounts,cognitoId, entityType);
    }
    while (accounts.length) {
        // eslint-disable-next-line no-await-in-loop
        await storeAccounts(accounts.splice(0, 25), reportId, cognitoId, entityType, dynamoDb);
    }

    return { message: 'Report successfully stored in db', id: reportId };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<GetReportEvent>,
    APIGatewayResponse<SuccessReportStoreResponse>>());

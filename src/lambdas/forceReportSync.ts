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
import {getNewToken, getAccountsInfo, getReport, 
    addAcctInfo, processReport, storeProcessedReport, getDeleteAccounts, deleteAccounts,
    getDeprecatedAccounts, updateAccounts, storeAccounts} from '../utils/qbo_sync_utils';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

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

const getReportSettings = async (reportId: string) => {
    const { Item: report } = await dynamoDb.get({
        TableName: process.env.reportsTable!,
        Key: {
            Id: reportId,
        },
    }).promise();

    if (report) {
        return report;
    }

    return undefined;
};

const rawHandler = async (
    event: APIGatewayEvent<SyncReportEvent>,
): Promise<APIGatewayResponse<SuccessReportStoreResponse>> => {

    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const reportSettings = await getReportSettings(event.pathParameters.reportId);

    if(reportSettings){
        const { Items } = await dynamoDb.scan({
            TableName: process.env.clientsTable!,
            FilterExpression: 'Id = :clientId and CognitoId = :cognitoId',
            ExpressionAttributeValues: {
                ':clientId': reportSettings.ClientId,
                ':cognitoId': cognitoId,
            },
        }).promise();
    
        if (Items && Items.length > 0) {
            
        } else throw Boom.badRequest('Client ID does not match report queried');
        
        const processedReport = await getAndProcessReport(Items[0].RealmId,
            reportSettings.endDate, reportSettings.accountingMethod, Items);
        if (processedReport){
            await storeProcessedReport(processedReport, reportSettings.Id, dynamoDb);
            const accounts = processedReport.Accounts;
            const accountsToUpdate = await getDeprecatedAccounts(reportSettings.Id, dynamoDb);

            if (accountsToUpdate && accountsToUpdate.length) {
                const updatedAccounts = compareAccounts(accountsToUpdate, accounts);
        
                const toBeDeletedAccounts = getDeleteAccounts(accountsToUpdate, accounts);
        
                while (updatedAccounts?.length) {
                    // eslint-disable-next-line no-await-in-loop
                    await updateAccounts(updatedAccounts.splice(0, 25),dynamoDb, cognitoId, reportSettings.EntityType);
                }
        
                while (toBeDeletedAccounts?.length){
                    await deleteAccounts(toBeDeletedAccounts.splice(0,25), dynamoDb)
                }
                return { message: 'Report Updated via Update Accounts', id: reportSettings.Id };
            }
        
            while (accounts.length) {
                // eslint-disable-next-line no-await-in-loop
                await storeAccounts(accounts.splice(0, 25), reportSettings.Id, cognitoId, reportSettings.EntityType, dynamoDb);
            }
            return { message: 'Report Updated via Store Accounts', id: reportSettings.Id };
        
        }else{
            throw Boom.internal('Error Processing Report');
        }
    } else throw Boom.badRequest('No Report was not found');
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<SyncReportEvent>,
    APIGatewayResponse<SuccessReportStoreResponse>>());

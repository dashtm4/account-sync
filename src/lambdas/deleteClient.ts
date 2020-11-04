import moment from 'moment';
import AWS from 'aws-sdk';
import Boom from '@hapi/boom';
import middy from 'middy';
import { v4 as uuid4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import { APIGatewayEvent, DeleteClientEvent, SuccessReportStoreResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const getAccounts = async (reportId: string) => {
    const { Items: accountsToUpdate } = await dynamoDb.scan({
        TableName: process.env.accountsTable!,
        FilterExpression: 'ReportId = :reportId',
        ExpressionAttributeValues: {
            ':reportId': reportId,
        },
    }).promise();

    return accountsToUpdate;
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



const getReports = async (clientId: string) => {
    const { Items: reports } = await dynamoDb.scan({
        TableName: process.env.reportsTable!,
        FilterExpression: 'ClientId = :clientId',
        ExpressionAttributeValues: {
            ':clientId': clientId,
        },
    }).promise();

    return reports;
};

const deleteReport = async (reportId: string) => {
    const deleteItems = [];
    const item = {
        DeleteRequest: {
            Key: {
                "Id": reportId
            },
        },
    };
    deleteItems.push(item);

    if (deleteItems.length > 0){
        await dynamoDb.batchWrite({
            RequestItems: {
                [process.env.reportsTable!]: [...deleteItems],
            },
        }).promise();
    }
    
};

const deleteClient = async (clientId: string) => {
    const deleteItems = [];
    const item = {
        DeleteRequest: {
            Key: {
                "Id": clientId
            },
        },
    };
    deleteItems.push(item);
    if (deleteItems.length > 0){
        await dynamoDb.batchWrite({
            RequestItems: {
                [process.env.clientsTable!]: [...deleteItems],
            },
        }).promise();
    }
};

const rawHandler = async (
    event: APIGatewayEvent<DeleteClientEvent>,
): Promise<APIGatewayResponse<SuccessReportStoreResponse>> => {
    const clientId = event.pathParameters["clientId"];

    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const { Items } = await dynamoDb.query({
        TableName: process.env.clientsTable!,
        FilterExpression: 'CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':cognitoId': cognitoId,
            ':Id': clientId,
        },
    }).promise();

    if (Items) {
        const reports = await getReports(Items[0].Id);

        for (const report of reports) {
            const accounts = getAccounts(report.Id);
            const acctIds = accounts.map((account) => account.Id);
            await deleteAccounts(acctIds);
            deleteReport(report.Id);
            deleteClient(clientId)
        }
    } else throw Boom.badRequest('Client with this Id was not found');

    
    return { message: 'Client Deleted', id: clientId };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent,
        SuccessDeleteClientResponse>());

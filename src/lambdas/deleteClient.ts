import moment from 'moment';
import AWS from 'aws-sdk';
import Boom from '@hapi/boom';
import middy from 'middy';
import { v4 as uuid4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import { APIGatewayEvent, DeleteClientEvent, SuccessDeleteClientResponse } from '../types/aws';
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
): Promise<APIGatewayResponse<SuccessDeleteClientResponse>> => {
    const clientId = event.pathParameters["clientId"];
    console.log(event.pathParameters);
    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const { Items } = await dynamoDb.query({
        TableName: process.env.clientsTable!,
        KeyConditionExpression: 'Id = :Id',
        FilterExpression: 'CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':cognitoId': cognitoId,
            ':Id': clientId,
        },
    }).promise();

    console.log("after client query");

    if (Items && Items[0]) {
        console.log("Items");
        console.log(JSON.stringify(Items));
        const reports = await getReports(Items[0].Id);
        if (reports){
            console.log(JSON.stringify(reports));
            for (const report of reports) {
                console.log(JSON.stringify(report));
                const accounts = await getAccounts(report.Id);
                if (accounts){
                    console.log(JSON.stringify(accounts));
                    const acctIds = accounts.map((account) => account.Id);
                    await deleteAccounts(acctIds);
                    console.log('after delete accounts');
                    deleteReport(report.Id);
                    console.log('after delete report');
                    deleteClient(clientId);
                    console.log('after delete client');
                }
            }
        }
    } else throw Boom.badRequest('Client with this Id was not found');

    
    return { message: 'Client Deleted', id: clientId };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<DeleteClientEvent>,
        SuccessDeleteClientResponse>());

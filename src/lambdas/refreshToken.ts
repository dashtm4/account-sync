/* eslint-disable no-await-in-loop */
import AWS from 'aws-sdk';
import middy from 'middy';
import Boom from '@hapi/boom';
import { jsonBodyParser } from 'middy/middlewares';
import OAuthClient from 'intuit-oauth';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { APIGatewayResponse } from '../utils/aws';
import { DefaultResponse, APIGatewayEvent } from '../types/aws';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: 'sandbox',
    redirectUri: 'http://localhost:8080',
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const rawHandler = async (event: APIGatewayEvent<null>)
: Promise<APIGatewayResponse<DefaultResponse>> => {
    const tableName = process.env.clientsTable!;

    const { Items } = await dynamoDb.scan({
        TableName: process.env.clientsTable!,
    }).promise();

    if (!Items) throw Boom.internal('No clients in database yet');

    const itemsForUpdate = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const item of Items) {
        const authResponse = await oauthClient.refreshUsingToken(item.Refresh_token);

        const tokens = authResponse.getToken();

        itemsForUpdate.push({
            PutRequest: {
                Item: {
                    HashKey: item.Id,
                    CognitoId: item.CognitoId,
                    Access_token: tokens.access_token,
                    Refresh_token: item.Refresh_token,
                },
            },
        });
    }
    try {
        await dynamoDb.batchWrite({
            RequestItems: {
                [tableName]: [...itemsForUpdate],
            },
        }).promise;
    } catch (e) {
        throw Boom.internal('Error during batch insert');
    }

    return { message: 'Successfully refreshed tokens' };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<null>, APIGatewayResponse<DefaultResponse>>());

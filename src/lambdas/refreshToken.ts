/* eslint-disable no-await-in-loop */
import AWS from 'aws-sdk';
import OAuthClient from 'intuit-oauth';
import middy from 'middy';
import Boom from '@hapi/boom';
import { jsonBodyParser } from 'middy/middlewares';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { APIGatewayEvent, ATokenEvent, DefaultResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
});

const rawHandler = async (
    event: APIGatewayEvent<ATokenEvent>): Promise<APIGatewayResponse<DefaultResponse>> => {
    const { sub: cognitoId } = event.requestContext.authorizer.claims;
    const { responseUri } = event.body;

    const { Items: clients } = await dynamoDb.scan({
        TableName: process.env.clientsTable!,
        FilterExpression: 'CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':cognitoid': cognitoId,
        },
    }).promise();

    if (!clients || !clients.length) {
        // eslint-disable-next-line no-console
        console.log('No clients in database yet');
        throw Boom.expectationFailed('No such client in database');
    }

    const authResponse = await oauthClient.createToken(responseUri);

    const tokens = authResponse.getToken();

    await dynamoDb.update({
        TableName: process.env.clientsTable!,
        Key: { Id: clients[0].Id },
        UpdateExpression: 'set #aT = :aToken, #rT = :rToken',
        ExpressionAttributeNames: {
            '#aT': 'AccessToken',
            '#rT': 'RefreshToken',
        },
        ExpressionAttributeValues: {
            ':aToken': tokens.access_token,
            ':rToken': tokens.refresh_token,
        },
    }).promise();

    return { message: 'Successfully updated tokens' };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<ATokenEvent>,
    APIGatewayResponse<DefaultResponse>>());

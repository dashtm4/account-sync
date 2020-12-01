import AWS from 'aws-sdk';
import middy from 'middy';
import axios from 'axios';
import Boom from '@hapi/boom';
import { v4 as uuidv4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import OAuthClient from 'intuit-oauth';
import { APIGatewayEvent, ATokenEvent, ClientResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const instance = axios.create({
    baseURL: process.env.intuitAPI,
});

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const rawHandler = async (
    event: APIGatewayEvent<ATokenEvent>,
): Promise<APIGatewayResponse<ClientResponse>> => {
    const { responseUri } = event.body;
    console.log('> storeTokens');
    const { sub: cognitoId } = event.requestContext.authorizer.claims;
    try {
        const authResponse = await oauthClient.createToken(responseUri);
        console.log('> storeToken: authResponse', authResponse);
        const tokens = authResponse.getToken();
        console.log('> storeToken: tokens', tokens.realmId, cognitoId, process.env.clientsTable!);

        const { Items: dbClients } = await dynamoDb.scan({
            TableName: process.env.clientsTable!,
            FilterExpression: 'RealmId = :realmId and CognitoId = :cognitoId',
            ExpressionAttributeValues: {
                ':realmId': tokens.realmId,
                ':cognitoId': cognitoId,
            },
        }).promise();

        const { data } = await instance.get(`company/${tokens.realmId}/query?query=select*from CompanyInfo`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                Accept: 'application/json',
            },
        });

        const companyName = data.QueryResponse.CompanyInfo[0].CompanyName;

        if (dbClients && dbClients.length > 0) {
            
            await dynamoDb.update({
                TableName: process.env.clientsTable!,
                Key: { Id: dbClients[0].Id!},
                UpdateExpression: 'set #atoken = :t1, #rtoken = :t2',
                ExpressionAttributeNames: {
                    '#atoken': 'AccessToken',
                    '#rtoken': 'RefreshToken',
                },
                ExpressionAttributeValues: {
                    ':t1': tokens.access_token,
                    ':t2': tokens.refresh_token,
                },
            }).promise();
            return Promise.resolve({ message: 'Client Token Update'});
        }

        await dynamoDb.put({
            TableName: process.env.clientsTable!,
            Item: {
                Id: uuidv4(),
                CognitoId: cognitoId,
                RealmId: tokens.realmId,
                CompanyName: companyName,
                AccessToken: tokens.access_token,
                RefreshToken: tokens.refresh_token,
            },
        }).promise();

        return Promise.resolve({ message: 'Account successfully connected, tokens are stored in database' });
    } catch (e) {
        throw Boom.internal('Something went wrong', e);
    }
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<ATokenEvent>,
    APIGatewayResponse<ClientResponse>>());

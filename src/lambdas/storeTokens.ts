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
    event: APIGatewayEvent<ATokenEvent>): Promise<APIGatewayResponse<ClientResponse>> => {
    const { responseUri } = event.body;

    const { sub: cognitoId } = event.requestContext.authorizer.claims;
    try {
        const authResponse = await oauthClient.createToken(responseUri);

        const tokens = authResponse.getToken();

        const { Items: dbClients } = await dynamoDb.scan({
            TableName: process.env.clientsTable!,
            FilterExpression: 'RealmId = :realmId and CognitoId = :cognitoId',
            ExpressionAttributeValues: {
                ':realmId': tokens.realmId,
                ':cognitoId': cognitoId,
            },
        }).promise();

        if (dbClients?.length) {
            return {
                message: 'Client already added',
                clientId: dbClients[0].Id!,
            };
        }

        const { data } = await instance.get(`company/${tokens.realmId}/query?query=select*from CompanyInfo`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                Accept: 'application/json',
            },
        });

        const companyName = data.QueryResponse.CompanyInfo[0].CompanyName;

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

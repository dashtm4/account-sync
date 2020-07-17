import AWS from 'aws-sdk';
import middy from 'middy';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import OAuthClient from 'intuit-oauth';
import { APIGatewayEvent, ATokenEvent, DefaultResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const instance = axios.create({
    baseURL: 'https://sandbox-quickbooks.api.intuit.com/v3/',
});

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: 'sandbox',
    redirectUri: 'https://www.google.com/',
});

const rawHandler = async (event: APIGatewayEvent<ATokenEvent>)
: Promise<APIGatewayResponse<DefaultResponse>> => {
    const { code, realmId } = event.body;

    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const authResponse = await oauthClient.createToken(code);

    const tokens = authResponse.getToken();

    const { data: companyData } = await instance.get(`company/${realmId}/companyInfo/${realmId}`, {
        headers: {
            Authorization: tokens.access_token,
            ContentType: 'application/json',
        },
    });

    await dynamoDb.put({
        TableName: process.env.clientsTable!,
        Item: {
            Id: uuidv4(),
            CognitoId: cognitoId,
            RealmId: realmId,
            CompanyName: companyData.CompanyName,
            AccessToken: tokens.access_token,
            RefreshToken: tokens.refresh_token,
        },
    }).promise();

    return Promise.resolve({ message: 'Account successfully connected, tokens are stored in database' });
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<ATokenEvent>,
    APIGatewayResponse<DefaultResponse>>());

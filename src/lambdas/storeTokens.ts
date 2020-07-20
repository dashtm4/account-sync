import AWS from 'aws-sdk';
import middy from 'middy';
import axios from 'axios';
import Boom from '@hapi/boom';
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
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const rawHandler = async (event: APIGatewayEvent<ATokenEvent>)
: Promise<APIGatewayResponse<DefaultResponse>> => {
    const { responseUri } = event.body;

    // console.log(event.body);

    const { sub: cognitoId } = event.requestContext.authorizer.claims;
    try {
        const authResponse = await oauthClient.createToken(responseUri);

        const tokens = authResponse.getToken();

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
    APIGatewayResponse<DefaultResponse>>());

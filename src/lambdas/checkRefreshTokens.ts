import AWS from 'aws-sdk';
import middy from 'middy';
import OAuthClient from 'intuit-oauth';
import { jsonBodyParser } from 'middy/middlewares';
import {
    APIGatewayEvent,
    CheckRefreshTokenResponse,
    GetClientIds,
} from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const rawHandler = async (
    event: APIGatewayEvent<GetClientIds>,
): Promise<APIGatewayResponse<CheckRefreshTokenResponse>> => {
    const { sub: cognitoId } = event.requestContext.authorizer.claims;
    const { clientIds } = event.body;

    const checkRefreshTokens: any = {};

    await Promise.all(clientIds.map((clientId: any) => dynamoDb.scan({
        TableName: process.env.clientsTable!,
        FilterExpression: 'Id = :clientId and CognitoId = :cognitoId',
        ExpressionAttributeValues: {
            ':clientId': clientId,
            ':cognitoId': cognitoId,
        },
    }).promise().then(async ({ Items }) => {
        if (Items) {
            const refreshToken = Items[0].RefreshToken;
            try {
                await oauthClient.refreshUsingToken(refreshToken);
                checkRefreshTokens[clientId] = 'valid';
            } catch {
                checkRefreshTokens[clientId] = 'expired';
            }
        } else {
            checkRefreshTokens[clientId] = 'not found';
        }
    })));

    return { response: checkRefreshTokens, message: 'success' };
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(
        apiGatewayResponse<
        APIGatewayEvent<GetClientIds>,
        APIGatewayResponse<CheckRefreshTokenResponse>
        >(),
    );

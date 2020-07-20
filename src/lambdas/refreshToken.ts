/* eslint-disable no-await-in-loop */
import AWS from 'aws-sdk';
import OAuthClient from 'intuit-oauth';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
});

export const handler = async (): Promise<void> => {
    const tableName = process.env.clientsTable!;

    const { Items } = await dynamoDb.scan({
        TableName: process.env.clientsTable!,
    }).promise();

    if (!Items || !Items.length) {
        // eslint-disable-next-line no-console
        console.log('No clients in database yet');
        return Promise.resolve();
    }

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
        return Promise.resolve();
    } catch (e) {
        // eslint-disable-next-line no-console
        console.log('Error during batch insert');
        return Promise.resolve();
    }
};

import AWS from 'aws-sdk';
import middy from 'middy';
import Boom from '@hapi/boom';
import { APIGatewayEvent, DownloadLinkResponse } from '../types/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';
import { APIGatewayResponse } from '../utils/aws';

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const bucketName = process.env.reportBucket!;

const rawHandler = async (
    event: APIGatewayEvent<null>,
): Promise<APIGatewayResponse<DownloadLinkResponse>> => {
    const reportId = event.pathParameters.id;

    const { Item: report } = await dynamoDb.get({
        TableName: process.env.reportsTable!,
        Key: { Id: reportId },
    }).promise();

    if (!report) {
        throw Boom.notAcceptable('Report with this Id was not found!');
    }

    if (report.DonwloadUrl) {
        return { message: 'Successfully uploaded to S3', link: report.DownloadUrl };
    }

    const { Item: client } = await dynamoDb.get({
        TableName: process.env.clientsTable!,
        Key: { Id: report.ClientId },
    }).promise();

    if (!client) {
        throw Boom.notAcceptable('Client connected to report was not found');
    }

    const reportYear = report.EndDate.slice(2, 4);
    const entityType = report.EntityType;

    const data = [`${reportYear}, ${entityType}`, '*', 'A,1,'];

    // eslint-disable-next-line no-restricted-syntax
    for (const account of report.Accounts.Accounts) {
        const taxCode = account.TaxCode ? account.TaxCode : '';
        const acctNum = account.AcctNum ? account.AcctNum : '';
        const value = account.ValueCents ? Math.round(account.ValueCents) : '';
        const name = account.AccountName ? account.AccountName : '';
        data.push(`${taxCode}\t${acctNum}\t${value}\t${name}`);
    }

    const key = `${client.CompanyName}-${reportYear}-Ultratax.DWI`;

    const params = {
        Body: data.join('\n'),
        Bucket: bucketName,
        Key: key,
        ACL: 'public-read',
    };

    await s3.putObject(params).promise();

    return { message: 'Successfully uploaded report', link: encodeURI(`${process.env.bucketLink}/${key}`) };
};

export const handler = middy(rawHandler)
    .use(apiGatewayResponse<APIGatewayEvent<null>,
    APIGatewayResponse<DownloadLinkResponse>>());

import moment from 'moment';
import OAuthClient from 'intuit-oauth';
import axios from 'axios';
import {
    QBTrialBalanceReport,  AccountInfoResponse,
} from '../types/reports';

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: process.env.environment,
    redirectUri: process.env.redirectUri,
});

const instance = axios.create({
    baseURL: process.env.intuitAPI!,
});

export const getNewToken = async (refreshToken: string): Promise<string[]> => {
    const authResponse = await oauthClient.refreshUsingToken(refreshToken);

    const tokens = authResponse.getToken();

    return [tokens.access_token, tokens.refresh_token];
};

export const getAccountsInfo = async (
    realmId: string,
    accessToken: string,
    ids: String[]): Promise<AccountInfoResponse> => {
    const accountInfo = await instance.get<AccountInfoResponse>(`company/${realmId}/query`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
        params: {
            query: `select * from Account where Id in ('${ids.join("','")}')`,
        },
    });

    return accountInfo.data;
};

export const getReport = async (realmId: string, accessToken: string, endPeriod: Date, accountingMethod: string) => {
    if (!accountingMethod){
        accountingMethod = "Accrual";
    }
    const trialBalanceReport = await instance.get<QBTrialBalanceReport>(`company/${realmId}/reports/TrialBalance`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
        params: {
            end_date: moment(endPeriod).format('YYYY-MM-DD'),
            start_date: moment(endPeriod).subtract(1, 'years').format('YYYY-MM-DD'),
            accounting_method: accountingMethod,
        },
    });

    return trialBalanceReport.data;
};
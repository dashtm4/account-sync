import { Account } from '../types/reports';

export const compareAccounts = (
    dbAccounts: AWS.DynamoDB.DocumentClient.ItemList,
    newAccounts: Account[],
) => {
    newAccounts.forEach((newAccount) => {
        dbAccounts.forEach((account) => {
            if (account.QboId === newAccount.QboId) {
                // eslint-disable-next-line no-param-reassign
                newAccount.Id = account.Id;
                newAccount.ReportId = account.ReportId;
                newAccount.TaxCode = account.TaxCode;
                newAccount.TaxCodeDescription = account.TaxCodeDescription;
                newAccount.Toggle = account.Toggle;
            }
        });
    });

    return newAccounts;
};
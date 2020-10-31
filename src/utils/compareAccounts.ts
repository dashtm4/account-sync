import { Account } from '../types/reports';

export const compareAccounts = (
    dbAccounts: AWS.DynamoDB.DocumentClient.ItemList,
    newAccounts: Account[],
) => {
    newAccounts.forEach((newAccount) => {
        dbAccounts.forEach((account) => {
            if (account.AccountName === newAccount.AccountName) {
                // eslint-disable-next-line no-param-reassign
                newAccount.TaxCode = account.TaxCode;
                newAccount.TaxCodeDescription = account.TaxCodeDescription;
                newAccount.Toggle = account.Toggle;
                newAccount.AcctNumber = account.AcctNumber;
                newAccount.Description = account.Description;
            }
        });
    });

    return newAccounts;
};
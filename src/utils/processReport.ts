const flipSign = (toggle: string | undefined, value: number) => {
    if (toggle && toggle.includes('Y')) {
        return Math.round(-value);
    }

    return Math.round(value);
};

const processUltraTax = (report: AWS.DynamoDB.DocumentClient.AttributeMap) => {
    const data = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const account of report.Accounts.Accounts) {
        const taxCode = account.TaxCode ? account.TaxCode : '';
        const acctNum = account.AcctNum ? account.AcctNum : '';
        const value = account.ValueCents ? flipSign(account.Toggle, account.ValueCents) : '';
        const name = account.AccountName;
        data.push(`${taxCode}\t${acctNum}\t${value}\t${name}`);
    }

    return data;
};

export const processReport = (
    report: AWS.DynamoDB.DocumentClient.AttributeMap,
) => {
    switch (report.Software) {
        case 'Ultratax':
            return processUltraTax(report);
        default:
            return [];
    }
};

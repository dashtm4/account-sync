export interface InternalTrialBalance {
    Id: string;
    CreatedAt: string;
    StartPeriod: string;
    EndPeriod: string;
    ReportBasis: string;
    Accounts: Account[];
    Total: {
        DebitCents: number;
        CreditCents: number;
    }
}

interface Account {
    AccountName: string;
    ValueCents: number;
    Type: string;
}

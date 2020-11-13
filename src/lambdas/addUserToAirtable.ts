
export const handler = async (event: any)
: Promise<any> => {
    var Airtable = require('airtable');
    Airtable.configure({
        endpointUrl: 'https://api.airtable.com',
        apiKey: process.env.AIRTABLE_API_KEY
    });
    var base = Airtable.base('appSgOJ4dAfje507d');
    console.log(JSON.stringify(event));
    base('Contacts').create([
        {
          "fields": {
            "Phone #": event.Detail.OfficePhoneNumber,
            "Name": event.Detail.Name,
            "Email Address": event.Detail.Address
          }
        },
      ], function(err: any, records: any) {
        if (err) {
          console.error(err);
          return;
        }
        records.forEach(function (record: any) {
          console.log(record.getId());
        });
      });
    return { message: 'Successfully signed new user' };
};


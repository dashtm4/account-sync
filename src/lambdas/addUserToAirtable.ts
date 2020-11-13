
export const handler = async (event: any)
: Promise<any> => {
    var Airtable = require('airtable');
    Airtable.configure({
        endpointUrl: 'https://api.airtable.com',
        apiKey: process.env.AIRTABLE_API_KEY
    });
    var base = Airtable.base('appSgOJ4dAfje507d');
    console.log(JSON.stringify(event));
    base('Contacts').create({
        "Phone #": event.detail.Item.OfficePhoneNumber,
        "Name": event.detail.Item.Name,
        "Email Address": event.detail.Item.Email
      }, function(err: any, record: any) {
        if (err) {
          console.log("Error creating record")
          console.error(err);
          return;
        }
        console.log(record.getId());
      });
};


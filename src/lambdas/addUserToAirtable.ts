
export const handler = (event: any, context: any, callback: any)
: Promise<any> => {
    
    console.log(JSON.stringify(event));
    var Airtable = require('airtable');
    Airtable.configure({
        endpointUrl: 'https://api.airtable.com',
        apiKey: process.env.AIRTABLE_API_KEY
    });
    var base = Airtable.base('appSgOJ4dAfje507d');
    base('Contacts').create({
        "Phone #": event.detail.Item.OfficePhoneNumber,
        "Name": event.detail.Item.Name,
        "Email Address": event.detail.Item.Email
    }, function (err: any, record: any) {
        console.log("callback executing");
        if (err) {
            console.log("Error creating record");
            console.error(err);
            return callback(Error(err));
        }else{
            console.log(record.getId());
            return callback(null, 200);
        }
    });
};



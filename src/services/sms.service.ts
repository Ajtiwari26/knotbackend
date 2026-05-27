import https from 'https';

const SMS_CREDENTIALS = {
  APIkey: "nThnVXGnSkyDLK2gUnCung",
  SenderId: "Nukadd",
  Channel: "2",
  DCS: "0",
  SchedTime: null,
  GroupId: null,
  EntityId: "1701172751226780335"
};

const DLT_TEMPLATE = {
  id: "1707173503754927297",
  preMsg: "Your OTP for NUKKAD login is",
  postMsg: "Nukkad one stop destination for Bhukkads."
};

export const sendOTPSMS = (phoneNumber: string, otp: string): Promise<{ success: boolean; data?: any; error?: string }> => {
  // Ensure the phone number starts with country code, but without '+' for SMSGatewayHub
  let phoneWithoutPlus = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  
  // Default to India prefix if a 10-digit number is passed
  if (!phoneWithoutPlus.startsWith('91') && phoneWithoutPlus.length === 10) {
    phoneWithoutPlus = '91' + phoneWithoutPlus;
  }

  const smsData = JSON.stringify({
    "Account": SMS_CREDENTIALS,
    "Messages": [
      {
        "Text": `${DLT_TEMPLATE.preMsg} ${otp}. ${DLT_TEMPLATE.postMsg}`,
        "DLTTemplateId": DLT_TEMPLATE.id,
        "Number": phoneWithoutPlus
      }
    ]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.smsgatewayhub.com',
      path: '/api/mt/SendSMS',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(smsData)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          resolve({
            success: result.ErrorCode === "000",
            data: result
          });
        } catch (error: any) {
          resolve({ success: false, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    req.write(smsData);
    req.end();
  });
};
export default { sendOTPSMS };

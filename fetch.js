// get list account from
fetch('http://localhost:20128/api/providers', {
  headers: {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.5',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'sec-ch-ua': '"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'sec-gpc': '1',
    Referer: 'http://localhost:20128/dashboard/providers/kiro',
  },
  body: null,
  method: 'GET',
});

// Response
{
  "connections": [
    {
              "modelLock_gemini-3-flash": "2026-06-22T19:08:26.120Z",
      "lastRefreshAt": "2026-06-19T14:45:11.121Z",
      "modelLock_gemini-3.1-pro-low": "2026-06-22T19:08:26.138Z",
      "modelLock_gemini-3.5-flash-extra-low": "2026-06-22T19:08:26.145Z",
      "consecutiveAuthFailures": 0,
      "modelLock___all": "2026-06-20T06:31:24.431Z",
      "lastQuotaSyncAt": "2026-06-20T06:01:24.434Z",
      "modelLock_gemini-3-flash-agent": "2026-06-22T19:08:26.160Z",
      "modelLock_gpt-oss-120b-medium": "2026-06-22T19:06:32.142Z",
      "modelLock_gemini-3.5-flash-low": "2026-06-22T19:08:26.153Z",
      "modelLock_gemini-pro-agent": "2026-06-22T19:08:26.157Z",
      "id": "eb74f871-c420-4318-b8ae-ffdf26180cb1",
      "provider": "antigravity",
      "authType": "oauth",
      "name": "wasaimek@gmail.com",
      "email": "wasaimek@gmail.com",
      "priority": 1,
      "isActive": true,
      "createdAt": "2026-05-16T06:56:55.765Z",
      "updatedAt": "2026-06-21T05:57:11.788Z"
    },
        {
      "expiresAt": "2026-06-21T05:05:11.841Z",
      "testStatus": "active",
      "providerSpecificData": {
        "profileArn": "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
        "authMethod": "imported",
        "provider": "Imported",
        "proxyPoolId": "c9abdf16-7d45-4fc0-bc0c-e0153ee49e6b"
      },
      "lastUsedAt": "2026-06-21T04:28:33.497Z",
      "consecutiveUseCount": 3,
      "lastRefreshAt": "2026-06-21T04:05:11.841Z",
      "expiresIn": 3600,
      "pausedUntil": null,
      "backoffLevel": 0,
      "id": "5736af57-d40a-488f-998a-b88be611be4f",
      "provider": "kiro",
      "authType": "oauth",
      "name": "\ttrialuha79@zuico.my.id",
      "email": null,
      "priority": 76,
      "isActive": true,
      "createdAt": "2026-06-20T22:13:48.070Z",
      "updatedAt": "2026-06-21T04:28:33.497Z"
    }
  ]
}

// Kiro
// Import Token
fetch("http://localhost:20127/api/oauth/kiro/import", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.5",
    "content-type": "application/json",
    "sec-ch-ua": "\"Brave\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "Referer": "http://localhost:20127/dashboard/providers/kiro"
  },
  "body": "{\"refreshToken\":\"aorAAAAAGqqMCg3LoCKuTfqYyFCa81r76VHeEFNL8Hk8mLLGdz8fyOcQExWFA4-KLryLPw01HgYQkR5SZ0xkMiwfUCkc0:MGQCMDZhgauBE2oAObZU71KKPNCm3IWBS3J/G5QNy9PkSkNiuZKxroWHpZw2VjlZ3mOCgwIwERmFjIpjM6dS0DVWmdLrwHdXyc+PraA2KZsMaWYRNuhu4U7exqEY4U+ecuOxHKi7\",\"name\":\"Testing\"}",
  "method": "POST"
});

// Response
{"success":true,"connection":{"id":"90085d9c-53e9-4698-8717-0938e91a28e6","provider":"kiro","email":null}}

// Openrouter
// Check Validate
fetch("http://localhost:20127/api/providers/validate", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.5",
    "content-type": "application/json",
    "sec-ch-ua": "\"Brave\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "Referer": "http://localhost:20127/dashboard/providers/openrouter"
  },
  "body": "{\"provider\":\"openrouter\",\"apiKey\":\"sdad\"}",
  "method": "POST"
});

// Response
{"valid":true,"error":null}

// Import Token
fetch("http://localhost:20127/api/providers", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.5",
    "content-type": "application/json",
    "sec-ch-ua": "\"Brave\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "Referer": "http://localhost:20127/dashboard/providers/openrouter"
  },
  "body": "{\"provider\":\"openrouter\",\"name\":\"Testing\",\"apiKey\":\"sdad\",\"priority\":1,\"proxyPoolId\":null,\"testStatus\":\"active\"}",
  "method": "POST"
});

// Response
{"connection":{"id":"06ae17b6-02a9-4f94-86c8-937827ba4257","provider":"openrouter","authType":"apikey","name":"Testing","priority":1,"isActive":true,"createdAt":"2026-06-21T06:27:01.292Z","updatedAt":"2026-06-21T06:27:01.292Z","testStatus":"active","providerSpecificData":{"connectionProxyEnabled":false,"connectionProxyUrl":"","connectionNoProxy":""}}}

// Silicon Flow
fetch("http://localhost:20127/api/providers", {
  "headers": {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.5",
    "content-type": "application/json",
    "sec-ch-ua": "\"Brave\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "Referer": "http://localhost:20127/dashboard/providers/siliconflow"
  },
  "body": "{\"provider\":\"siliconflow\",\"name\":\"asdad\",\"apiKey\":\"asdasd\",\"priority\":1,\"proxyPoolId\":null,\"testStatus\":\"unknown\"}",
  "method": "POST"
});

// Response
{"connection":{"id":"1929de70-1536-445c-8159-2b8aafb94a40","provider":"siliconflow","authType":"apikey","name":"asdad","priority":1,"isActive":true,"createdAt":"2026-06-21T06:36:17.240Z","updatedAt":"2026-06-21T06:36:17.240Z","testStatus":"unknown","providerSpecificData":{"connectionProxyEnabled":false,"connectionProxyUrl":"","connectionNoProxy":""}}}

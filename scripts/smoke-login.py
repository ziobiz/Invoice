#!/usr/bin/env python3
import json, urllib.request
env = open('/root/invoice-service-secrets.env').read().splitlines()
pw = next(l.split('=',1)[1].strip().strip('"') for l in env if l.startswith('ADMIN_PASSWORD='))
body = json.dumps({'email':'admin@invoice.local','password':pw}).encode()
req = urllib.request.Request(
    'http://127.0.0.1:3100/admin/api/auth/login',
    data=body,
    headers={'Content-Type':'application/json'},
)
try:
    print(urllib.request.urlopen(req).read().decode())
except Exception as e:
    if hasattr(e, 'read'):
        print(e.read().decode())
    else:
        print(e)

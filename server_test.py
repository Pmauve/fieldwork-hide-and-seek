import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

temporary = tempfile.TemporaryDirectory()
os.environ['DATA_DIR'] = temporary.name
os.environ['AUTH_DISABLED_FOR_TESTS'] = '1'
import server

class PersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def request(self, path, data=None):
        req = urllib.request.Request(self.url+path, data=json.dumps(data).encode() if data else None, headers={'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_atomic_save_and_stale_writer_rejection(self):
        _, first = self.request('/api/workbook')
        book = first['book']
        book['rounds'].append({'id':'test-round','name':'Second round','items':[]})
        status, saved = self.request('/api/workbook', {'revision':first['revision'],'book':book})
        self.assertEqual(status,200)
        status, conflict = self.request('/api/workbook', {'revision':first['revision'],'book':book})
        self.assertEqual(status,409)
        self.assertEqual(conflict['revision'],saved['revision'])
        with server.connect() as db:
            persisted = json.loads(db.execute('SELECT body FROM workbook WHERE id=1').fetchone()[0])
        self.assertEqual(persisted['rounds'][-1]['name'],'Second round')

    def test_rejects_non_google_resolver_targets(self):
        self.assertEqual(self.request('/api/resolve',{'url':'http://127.0.0.1/secret'})[0],400)
        self.assertEqual(self.request('/api/resolve',{'url':'https://example.com/'})[0],400)

    def test_rejects_invalid_workbook(self):
        self.assertEqual(self.request('/api/workbook',{'revision':0,'book':{'version':2,'rounds':[]}})[0],400)

    def test_local_mode_rejects_foreign_hosts_and_origins(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {'STATIC_DIR': os.getcwd()}):
            for headers in ({'Host':'evil.example'}, {'Origin':'https://evil.example'}):
                req = urllib.request.Request(self.url+'/api/workbook', headers=headers)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(req)
                self.assertEqual(error.exception.code,403)
            self.assertEqual(self.request('/api/workbook')[0],200)

if __name__ == '__main__':
    unittest.main()

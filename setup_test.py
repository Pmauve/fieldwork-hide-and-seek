import json
from pathlib import Path
import tempfile
import unittest

from make_access import create


class SetupTests(unittest.TestCase):
    def test_fresh_credentials_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            create('https://maps.example.org/', 7, root)
            config = json.loads((root / 'secrets/auth.json').read_text())
            self.assertEqual(config['origins'], ['https://maps.example.org'])
            self.assertNotIn('password', config)
            self.assertIn('<svg', (root / 'enrollment/authenticator.svg').read_text())
            before = (root / 'secrets/auth.json').read_bytes()
            with self.assertRaises(ValueError):
                create('https://maps.example.org', 7, root)
            self.assertEqual(before, (root / 'secrets/auth.json').read_bytes())

    def test_invalid_origins_do_not_create_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for url in ('http://example.org', 'https://example.org/path', 'https://user@example.org', 'https://example.org:invalid', 'https://example.org?token=x'):
                with self.assertRaises(ValueError):
                    create(url, 7, root)
            self.assertFalse((root / 'secrets').exists())


if __name__ == '__main__':
    unittest.main()

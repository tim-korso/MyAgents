import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('smoke', Path(__file__).with_name('linux-package-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class InstalledResourceTests(unittest.TestCase):
    def test_resource_integrity_and_path_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'resources'
            root.mkdir()
            path = root / 'model'
            path.write_bytes(b'model')
            entry = dict(path='model', size=5, sha256=hashlib.sha256(b'model').hexdigest())
            self.assertEqual(smoke.checked_file(root, entry), path)
            path.write_bytes(b'other')
            with self.assertRaisesRegex(ValueError, 'Hash mismatch'):
                smoke.checked_file(root, entry)
            path.write_bytes(b'x')
            with self.assertRaisesRegex(ValueError, 'Size mismatch'):
                smoke.checked_file(root, entry)
            outside = root.parent / 'outside'
            outside.write_bytes(b'model')
            with self.assertRaisesRegex(ValueError, 'Invalid manifest'):
                smoke.checked_file(root, dict(entry, path='../outside'))
            path.unlink()
            path.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'Invalid manifest'):
                smoke.checked_file(root, entry)

    def test_wrong_elf_target_fails_before_external_command(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'worker'
            header = bytearray(20)
            header[:6] = b'\x7fELF\x02\x01'
            header[18:20] = (183).to_bytes(2, 'little')
            path.write_bytes(header)
            with self.assertRaisesRegex(ValueError, 'Not an x86-64'):
                smoke.check_elf(path)

    def test_renamed_native_libraries_load_in_dependency_order(self):
        document = {'files': {'onnxRuntime': {'path': 'native/onnxruntime.so'},
                              'pdfium': {'path': 'native/pdfium.so'}}}
        speech = {'files': {'sherpaOnnx': {'path': 'native/sherpa-onnx-c-api.so'},
                            'adapter': {'path': 'native/myagents-speech-adapter.so'}}}
        calls = []

        def load(path, mode=None):
            if path.endswith('/sherpa-onnx-c-api.so'):
                self.assertIn(('/document/native/onnxruntime.so', smoke.ctypes.RTLD_GLOBAL), calls)
            if path.endswith('/myagents-speech-adapter.so'):
                self.assertIn(('/speech/native/sherpa-onnx-c-api.so', smoke.ctypes.RTLD_GLOBAL), calls)
            calls.append((path, mode))
            return MagicMock()

        with patch.object(smoke.ctypes, 'CDLL', side_effect=load), patch.object(
                smoke.subprocess, 'run', side_effect=AssertionError('bare ldd cannot resolve renamed SONAMEs')):
            libraries = smoke.load_native_libraries(Path('/document'), document, Path('/speech'), speech)
        self.assertEqual(len(libraries), 4)
        self.assertEqual(len(calls), 4)


if __name__ == '__main__':
    unittest.main()

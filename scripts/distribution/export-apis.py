"""Export only EasySch API credentials requested by the owner, never Zotero logins.

The output is a private packaging input; passwords are not logged or committed.
Requires the source profile to be closed. A protected primary password is not bypassed.
"""
import argparse
import base64
import ctypes
import json
import os
from pathlib import Path


class SECItem(ctypes.Structure):
    _fields_ = [('type', ctypes.c_uint), ('data', ctypes.c_void_p), ('len', ctypes.c_uint)]


def export(profile, client, workspace, destination):
    logins = json.loads((profile / 'logins.json').read_text('utf-8'))['logins']
    logins = [v for v in logins if v.get('hostname') == 'chrome://easysch']
    state = json.loads(workspace.read_text('utf-8'))
    settings = {k: v for k, v in state['settings'].items()
                if k in ['endpoint', 'model', 'youdaoAppID', 'language', 'documentLanguage']}
    dll_directory = os.add_dll_directory(str(client))
    nss = ctypes.CDLL(str(client / 'nss3.dll'))
    nss.NSS_Init.argtypes = [ctypes.c_char_p]
    nss.NSS_Init.restype = ctypes.c_int
    nss.PK11SDR_Decrypt.argtypes = [ctypes.POINTER(SECItem), ctypes.POINTER(SECItem), ctypes.c_void_p]
    nss.PK11SDR_Decrypt.restype = ctypes.c_int
    nss.SECITEM_FreeItem.argtypes = [ctypes.POINTER(SECItem), ctypes.c_int]
    nss.NSS_Shutdown.restype = ctypes.c_int
    if nss.NSS_Init(('sql:' + str(profile)).encode('utf-8')) != 0:
        raise RuntimeError('Cannot open the closed EasySch credential store.')
    credentials = []
    try:
        for login in logins:
            endpoint = login.get('httpRealm', '')
            if not endpoint.startswith('https://'):
                continue
            encrypted = base64.b64decode(login['encryptedPassword'])
            buf = ctypes.create_string_buffer(encrypted)
            src = SECItem(0, ctypes.cast(buf, ctypes.c_void_p), len(encrypted))
            dst = SECItem()
            if nss.PK11SDR_Decrypt(ctypes.byref(src), ctypes.byref(dst), None) != 0:
                raise RuntimeError('Credential decryption failed; primary password protection is not bypassed.')
            try:
                key = ctypes.string_at(dst.data, dst.len).decode('utf-8')
                if key:
                    credentials.append({'endpoint': endpoint, 'key': key})
            finally:
                nss.SECITEM_FreeItem(ctypes.byref(dst), 0)
        if not credentials:
            raise RuntimeError('No configured EasySch API credentials found.')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps({'version': 1, 'settings': settings,
                                           'credentials': credentials}, ensure_ascii=False), 'utf-8')
        print(json.dumps({'exported': len(credentials), 'providers': [c['endpoint'] for c in credentials]}))
    finally:
        nss.NSS_Shutdown()
        dll_directory.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['profile', 'client', 'workspace', 'destination']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    export(**vars(args))

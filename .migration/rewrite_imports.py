import io, os, re, sys

SHARED = [
    ('navigation',   '@mirwal/shared/navigation'),
    ('Icon',         '@mirwal/shared/Icon'),
    ('useApiQuery',  '@mirwal/shared/useApiQuery'),
    ('apiClient',    '@mirwal/shared/apiClient'),
    ('money',        '@mirwal/shared/money'),
    ('PageStates',   '@mirwal/shared/PageStates'),
    ('global.css',   '@mirwal/shared/styles/global.css'),
]

# matches a relative specifier of any depth whose final segment is the module we care about
def pattern(base):
    return re.compile(
        r"(['\"])(?:\.{1,2}/)+(?:[A-Za-z0-9_\-]+/)*" + re.escape(base) + r"(['\"])"
    )

def rewrite(path, app_src):
    s = io.open(path, encoding='utf-8').read()
    orig = s
    for base, pkg in SHARED:
        s = pattern(base).sub(lambda m: m.group(1) + pkg + m.group(2), s)

    # per-app API surface: any relative ".../services/api" -> that app's own api.js
    api_target = os.path.join(app_src, 'api.js')
    rel = os.path.relpath(api_target, os.path.dirname(path)).replace(os.sep, '/')
    if not rel.startswith('.'):
        rel = './' + rel
    rel = rel[:-3]
    s = re.sub(r"(['\"])(?:\.{1,2}/)+services/api(['\"])",
               lambda m: m.group(1) + rel + m.group(2), s)

    if s != orig:
        io.open(path, 'w', encoding='utf-8').write(s)
        return True
    return False

changed = 0
for app in sys.argv[1:]:
    src = os.path.join('apps', app, 'src')
    for root, _dirs, files in os.walk(src):
        for f in files:
            if f.endswith(('.jsx', '.js')):
                if rewrite(os.path.join(root, f), src):
                    changed += 1
print('files rewritten:', changed)

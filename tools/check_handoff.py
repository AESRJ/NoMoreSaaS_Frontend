import argparse, json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--implementation-ready', default=None)
a = p.parse_args()
try:
    path = (ROOT / (a.implementation_ready or '.project/handoffs/002-catalogo-comparacion.json')).resolve()
    assert path.is_relative_to(ROOT), 'Ruta fuera del checkout'
    h = json.loads(path.read_text(encoding='utf-8'))
    assert h['status'] in {'ready', 'in_review', 'closed'}, 'Estado de entrega no operativo'
    if a.implementation_ready:
        assert h['status'] == 'ready' and not h['blockers'], 'Entrega no autorizada para nueva implementacion'
    assert h['planner'] == 'codex' and h['executor'] == 'claude-code'
    assert h['execution_repository'] == 'https://github.com/AESRJ/NoMoreSaaS_Frontend.git'
    spec = (ROOT / h['spec_dir']).resolve()
    assert spec.is_relative_to(ROOT)
    for name in ['spec.md', 'plan.md', 'tasks.md', 'data-model.md', 'research.md', 'quickstart.md']:
        assert (spec / name).is_file(), 'Falta ' + name
    text = (spec / 'tasks.md').read_text(encoding='utf-8')
    ids = re.findall(r'^- \[([ xX])\] (T[0-9]+)\b', text, re.M)
    assert set(h['task_ids']) <= {i for _, i in ids}, 'IDs de tareas incompletos'
    for value in h['allowed_paths']:
        assert (ROOT / value).resolve().is_relative_to(ROOT), 'Alcance fuera del checkout'
    print('OK: entrega, destino, artefactos y tareas; completadas', sum(c.lower() == 'x' for c, _ in ids), 'de', len(ids))
except (AssertionError, OSError, ValueError, KeyError) as e:
    print('ERROR:', e, file=sys.stderr)
    sys.exit(1)

import argparse, json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
HANDOFFS = ROOT / '.project' / 'handoffs'


def inside(path):
    """Ruta resuelta dentro del checkout; si no, error."""
    resolved = (ROOT / path).resolve()
    assert resolved.is_relative_to(ROOT), 'Ruta fuera del checkout: ' + str(path)
    return resolved


def current_feature():
    """Directorio de la feature actual.

    1. Puntero local .specify/feature.json (ignorado por Git) si existe.
    2. Si no (clon limpio, CI): referencia versionada .project/identity-source.json
       (source_directory relativo a .project/).
    Nunca vuelve en silencio a otra entrega (p. ej. 002).
    """
    pointer = ROOT / '.specify' / 'feature.json'
    if pointer.is_file():
        return inside(json.loads(pointer.read_text(encoding='utf-8'))['feature_directory']), '.specify/feature.json'
    source = ROOT / '.project' / 'identity-source.json'
    assert source.is_file(), 'Sin puntero local ni referencia versionada de la feature actual; usa --handoff'
    directory = json.loads(source.read_text(encoding='utf-8'))['source_directory']
    return inside(Path('.project') / directory), '.project/identity-source.json'


def current_handoff():
    """Entrega cuyo spec_dir coincide con la feature actual."""
    feature, origin = current_feature()
    matches = [f for f in sorted(HANDOFFS.glob('*.json'))
               if inside(json.loads(f.read_text(encoding='utf-8')).get('spec_dir', '')) == feature]
    assert len(matches) == 1, 'La feature de ' + origin + ' no corresponde a una unica entrega'
    return matches[0]


p = argparse.ArgumentParser(description='Valida una entrega. Por defecto, la del puntero .specify/feature.json.')
group = p.add_mutually_exclusive_group()
group.add_argument('--implementation-ready', default=None, metavar='HANDOFF',
                   help='Exige estado ready sin bloqueos (antes de implementar).')
group.add_argument('--handoff', default=None, metavar='HANDOFF',
                   help='Revisa una entrega concreta, p. ej. .project/handoffs/002-catalogo-comparacion.json.')
a = p.parse_args()
try:
    explicit = a.implementation_ready or a.handoff
    path = inside(explicit) if explicit else current_handoff()
    h = json.loads(path.read_text(encoding='utf-8'))
    assert h['status'] in {'ready', 'in_review', 'closed'}, 'Estado de entrega no operativo'
    if a.implementation_ready:
        assert h['status'] == 'ready' and not h['blockers'], 'Entrega no autorizada para nueva implementacion'
    assert h['planner'] == 'codex' and h['executor'] == 'claude-code'
    assert h['execution_repository'] == 'https://github.com/AESRJ/NoMoreSaaS_Frontend.git'
    spec = inside(h['spec_dir'])
    for name in ['spec.md', 'plan.md', 'tasks.md', 'data-model.md', 'research.md', 'quickstart.md']:
        assert (spec / name).is_file(), 'Falta ' + name
    text = (spec / 'tasks.md').read_text(encoding='utf-8')
    ids = re.findall(r'^- \[([ xX])\] (T[0-9]+)\b', text, re.M)
    assert set(h['task_ids']) <= {i for _, i in ids}, 'IDs de tareas incompletos'
    for value in h['allowed_paths']:
        inside(value)
    print('OK:', path.relative_to(ROOT).as_posix(), '(' + h['feature_id'] + ', ' + h['status'] + ');',
          'entrega, destino, artefactos y tareas; completadas', sum(c.lower() == 'x' for c, _ in ids), 'de', len(ids))
except (AssertionError, OSError, ValueError, KeyError) as e:
    print('ERROR:', e, file=sys.stderr)
    sys.exit(1)

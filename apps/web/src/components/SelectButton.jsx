import { useComparison } from '../store/comparison.js';
import { Icon } from './Icon.jsx';

/** Alterna una alternativa en la selección. El nombre accesible incluye la alternativa. */
export function SelectButton({ alternative, compact = false }) {
  const selected = useComparison((state) => state.ids.includes(alternative.id));
  const add = useComparison((state) => state.add);
  const remove = useComparison((state) => state.remove);

  return (
    <button
      type="button"
      className={`button ${selected ? 'button--selected' : 'button--secondary'}${compact ? ' button--small' : ''}`}
      aria-pressed={selected}
      onClick={() => (selected ? remove(alternative.id) : add(alternative.id))}
    >
      <Icon name={selected ? 'check' : 'plus'} className="button__icon" />
      <span>
        {selected ? 'Quitar ' : 'Añadir '}
        <span className="sr-only">{alternative.name}</span>
        {selected ? ' de la comparación' : ' a la comparación'}
      </span>
    </button>
  );
}

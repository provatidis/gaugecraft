export function AllocationSize({
  value,
  onChange,
  children,
  showAssumptions = true,
}: {
  children?: React.ReactNode;
  showAssumptions?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const reference = value.trim() === "";
  const invalid =
    !reference && (!Number.isFinite(Number(value)) || Number(value) <= 0);
  return (
    <div className="allocation-size">
      <label>
        <span>Intended allocation power</span>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="1,000 reference"
          value={value}
          aria-invalid={invalid}
          aria-describedby="allocation-size-help"
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {children}
      <div id="allocation-size-help">
        <b>
          {invalid
            ? "Enter a positive allocation power."
            : reference
              ? "Each row uses 1,000 additional power"
              : "Each row uses your full allocation power"}
        </b>
        {showAssumptions && (
          <p>Enter the allocation power shown for your sAERO stake.</p>
        )}
      </div>
      {!reference && (
        <button className="text-link" onClick={() => onChange("")}>
          Use reference size
        </button>
      )}
      {showAssumptions && (
        <details className="comparison-assumptions">
          <summary>How earnings and stress are calculated</summary>
          <p>
            Immediate allocation, constant power. Existing power set in
            Simulator is remembered per pool. Timing and decay can be explored
            there.
          </p>
          <p>
            Your intended power ÷ (projected other power + your intended power)
            × modeled pool revenue. Existing power is removed before projecting
            competing allocation. Incentives stop at their scheduled expiry.
            Clearing the input uses 1,000 additional reference power and ignores
            personal existing allocations.
          </p>
          <p>
            Stress reduces forecast fees by 50% and increases projected
            competing power by 50%; scheduled incentive USD value stays
            unchanged. It is a scenario, not a probability. History-based
            estimates and full-window baselines are compared in separate groups.
            Partial fee windows, stale data and missing prices cannot support a
            comparable earnings total.
          </p>
        </details>
      )}
    </div>
  );
}

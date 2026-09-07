import { StatusBadge } from "@/components/status-badge";
import type { StudentDeliveryMatrix as Matrix } from "@/lib/admin-data";

/**
 * Every active student against every published assignment. Teams are re-cut
 * each assignment, so a student is the only identity stable enough to read
 * across the whole semester — this is where a chronic no-show shows up as a
 * row, not a scattered set of per-assignment gaps.
 */
export function StudentDeliveryMatrix({ matrix }: { matrix: Matrix }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
            <th
              scope="col"
              className="sticky left-0 bg-card px-4 py-2.5 text-left font-medium"
            >
              Student
            </th>
            {matrix.columns.map((a) => (
              <th key={a.id} scope="col" className="px-2 py-2.5 text-center font-medium">
                {a.weekNumber != null ? `W${a.weekNumber}` : a.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {matrix.rows.map((row) => (
            <tr key={row.student.id}>
              <td className="sticky left-0 bg-card px-4 py-2 font-medium whitespace-nowrap">
                {row.student.name}
              </td>
              {row.cells.map((cell) => (
                <td key={cell.assignmentId} className="px-2 py-2 text-center">
                  <StatusBadge state={cell.state} size="sm" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { formattedValueToString, getDisplayProcessor } from '@grafana/data';
import { type CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import { MaybeWrapWithLink } from '@grafana/ui/internal';
import { type Category, resolveProtectedLogCell, useProtectedLogDisplayEpoch } from 'app/features/logs/components/protectedLogDisplay';

export function ProtectedLogsTableCell({ field, frame, rowIndex, value, isBody, category }: CustomCellRendererProps & { isBody: boolean; category?: Category }) {
  useProtectedLogDisplayEpoch();
  const theme = useTheme2();
  const visible = resolveProtectedLogCell(field.name, value, frame, rowIndex, isBody, category);
  if (visible !== undefined) {
    // A data link's href is based on raw field values; it is not a display-copy action.
    return <span>{visible}</span>;
  }
  const display = field.display ?? getDisplayProcessor({ field, theme });
  return (
    <MaybeWrapWithLink field={field} rowIdx={rowIndex}>
      {formattedValueToString(display(value))}
    </MaybeWrapWithLink>
  );
}

import { formattedValueToString, getDisplayProcessor } from '@grafana/data';
import { type CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import { MaybeWrapWithLink } from '@grafana/ui/internal';
import { ProtectedLogCell } from 'app/features/logs/components/ProtectedLogText';
import { type Category } from 'app/features/logs/components/protectedLogDisplay';

export function ProtectedLogsTableCell({ field, frame, rowIndex, value, isBody, category }: CustomCellRendererProps & { isBody: boolean; category?: Category }) {
  const theme = useTheme2();
  const visible = ProtectedLogCell({ field: field.name, value, frame, rowIndex, isBody, category });
  if (visible !== undefined) {
    return <span>{visible}</span>;
  }
  const display = field.display ?? getDisplayProcessor({ field, theme });
  return (
    <MaybeWrapWithLink field={field} rowIdx={rowIndex}>
      {formattedValueToString(display(value))}
    </MaybeWrapWithLink>
  );
}

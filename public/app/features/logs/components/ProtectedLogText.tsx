import { type ReactNode } from 'react';

import { type DataFrame } from '@grafana/data';
import { ProtectedValue } from '@grafana/ui';

import {
  type Category,
  containsProtectedLogValue,
  protectedLogCellCategory,
  protectedLogKeyId,
  protectedLogLineSegments,
  requestProtectedLogKey,
  resolveProtectedLogField,
  useProtectedLogDisplayEpoch,
} from './protectedLogDisplay';

interface FieldProps {
  category: Category;
  fieldName: string;
  value: string;
  onDisplayedValueChange?: (value: string) => void;
}

export function ProtectedLogField({ category, fieldName, value, onDisplayedValueChange }: FieldProps) {
  const epoch = useProtectedLogDisplayEpoch();
  if (!containsProtectedLogValue(value)) {
    return <>{value}</>;
  }
  const displayValue = resolveProtectedLogField(category, fieldName, value);
  const kid = protectedLogKeyId(value);
  if (!kid) {
    return <>{displayValue === '[encrypted: invalid data]' ? 'Invalid data' : displayValue}</>;
  }
  return (
    <ProtectedValue
      value={value}
      kid={kid}
      displayValue={displayValue}
      fieldName={fieldName}
      epoch={epoch}
      onLoadKey={() => requestProtectedLogKey(value)}
      onDisplayedValueChange={onDisplayedValueChange}
    />
  );
}

export function ProtectedLogText({ value }: { value: string }) {
  return <>{protectedLogLineSegments(value).map((segment, index) =>
    'text' in segment ? segment.text : 'invalid' in segment ? 'Invalid data' : (
      <ProtectedLogField category={segment.category} fieldName={segment.field} value={segment.value} key={index} />
    )
  )}</>;
}

export function ProtectedLogCell({
  field,
  value,
  frame,
  rowIndex,
  isBody,
  category,
}: {
  field: string;
  value: unknown;
  frame: DataFrame;
  rowIndex: number;
  isBody: boolean;
  category?: Category;
}): ReactNode {
  if (typeof value === 'string') {
    if (!containsProtectedLogValue(value)) {
      return undefined;
    }
    return isBody ? <ProtectedLogText value={value} /> : (
      <ProtectedLogField category={protectedLogCellCategory(frame, rowIndex, field, category)} fieldName={field} value={value} />
    );
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.some(([, item]) => containsProtectedLogValue(item))) {
      return <>{'{'}{entries.map(([name, item], index) => (
        <span key={name}>
          {index > 0 ? ',' : ''}{JSON.stringify(name)}:
          {typeof item === 'string' && containsProtectedLogValue(item) ? (
            <>{'"'}<ProtectedLogField
              category={field === 'labels' ? protectedLogCellCategory(frame, rowIndex, name, 'label') : 'metadata'}
              fieldName={name}
              value={item}
            />{'"'}</>
          ) : JSON.stringify(item)}
        </span>
      ))}{'}'}</>;
    }
  }
  return undefined;
}

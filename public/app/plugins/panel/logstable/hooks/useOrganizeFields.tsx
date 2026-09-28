import { merge } from 'lodash';
import { useEffect, useState } from 'react';
import useMountedState from 'react-use/lib/useMountedState';
import { lastValueFrom } from 'rxjs';

import { type DataFrame, type FieldConfigSource, transformDataFrame } from '@grafana/data';
import { type CustomCellRendererProps, TableCellDisplayMode } from '@grafana/ui';
import { type LogsFrame } from 'app/features/logs/logsFrame';
import { containsProtectedLogValue, inferLogFieldCategory, withLogFieldProvenance } from 'app/features/logs/components/protectedLogDisplay';

import { LOG_LINE_BODY_FIELD_NAME } from '../../../../features/logs/components/fieldSelector/logFields';
import { ProtectedLogsTableCell } from '../cells/ProtectedLogsTableCell';
import { LogsTableCustomCellRenderer } from '../cells/LogsTableCustomCellRenderer';
import { getLogLevelColumnEnhancements } from '../fields/defaultLogLevelColumnConfig';
import { getTimeFieldWidth } from '../fields/getFieldWidth';
import { doesFieldSupportAdHocFiltering, doesFieldSupportInspector } from '../fields/supports';
import { getDisplayedFields } from '../options/getDisplayedFields';
import type { Options as LogsTableOptions } from '../panelcfg.gen';
import { organizeLogsFieldsTransform } from '../transforms/organizeLogsFieldsTransform';
import { type BuildLinkToLogLine, isBuildLinkToLogLine } from '../types';

interface Props {
  extractedFrame: DataFrame | null;
  sourceFrame?: DataFrame | null;
  timeFieldName: string;
  levelFieldName: string;
  bodyFieldName: string;
  options: LogsTableOptions;
  logsFrame: LogsFrame | null;
  supportsPermalink: boolean;
  onPermalinkClick: BuildLinkToLogLine;
  fieldConfig: FieldConfigSource;
  timeColumnHeaderTooltip?: string;
}

export function useOrganizeFields({
  extractedFrame,
  sourceFrame,
  timeFieldName,
  levelFieldName,
  bodyFieldName,
  logsFrame,
  supportsPermalink,
  onPermalinkClick,
  options,
  fieldConfig,
  timeColumnHeaderTooltip,
}: Props) {
  const [organizedFrame, setOrganizedFrame] = useState<DataFrame | null>(null);
  const isMounted = useMountedState();

  /**
   * Organize fields transform
   */
  useEffect(() => {
    if (!extractedFrame || !timeFieldName || !bodyFieldName || !logsFrame) {
      return;
    }

    organizeFields(
      extractedFrame,
      sourceFrame,
      options,
      logsFrame,
      timeFieldName,
      levelFieldName,
      bodyFieldName,
      supportsPermalink,
      onPermalinkClick,
      fieldConfig,
      timeColumnHeaderTooltip
    )
      .then((frame) => {
        if (frame && isMounted()) {
          setOrganizedFrame(frame);
        }
      })
      .catch((err) => {
        console.error('LogsTable: Organize fields transform error', err);
      });
  }, [
    bodyFieldName,
    levelFieldName,
    extractedFrame,
    sourceFrame,
    options,
    timeFieldName,
    logsFrame,
    supportsPermalink,
    onPermalinkClick,
    isMounted,
    fieldConfig,
    timeColumnHeaderTooltip,
  ]);

  return { organizedFrame };
}

const organizeFields = async (
  extractedFrame: DataFrame,
  sourceFrame: DataFrame | null | undefined,
  options: LogsTableOptions,
  logsFrame: LogsFrame,
  timeFieldName: string,
  levelFieldName: string,
  bodyFieldName: string,
  supportsPermalink: boolean,
  onPermalinkClick: BuildLinkToLogLine,
  fieldConfig: FieldConfigSource,
  timeColumnHeaderTooltip?: string
) => {
  if (!extractedFrame) {
    return Promise.resolve(null);
  }

  const displayedFields = getDisplayedFields(options, timeFieldName, levelFieldName);

  let indexByName: Record<string, number> = {};
  let includeByName: Record<string, boolean> = {};
  for (let [idx, field] of displayedFields.entries()) {
    // interop with logs panel
    if (field === LOG_LINE_BODY_FIELD_NAME) {
      field = bodyFieldName;
    }
    indexByName[field] = idx;
    includeByName[field] = true;
  }

  const extractedWithProvenance = withLogFieldProvenance(extractedFrame, sourceFrame ?? extractedFrame);
  if (!includeByName.labelTypes && extractedWithProvenance.fields.some((field) => field.name === 'labelTypes')) {
    indexByName.labelTypes = displayedFields.length;
    includeByName.labelTypes = true;
  }

  const organizedFrame = await lastValueFrom(
    transformDataFrame(organizeLogsFieldsTransform(indexByName, includeByName), [extractedWithProvenance])
  );

  for (let frameIndex = 0; frameIndex < organizedFrame.length; frameIndex++) {
    const frame = organizedFrame[frameIndex];

    const levelField = frame.fields.find((f) => f.name === levelFieldName);
    let isLevelFirstField = false;
    if (levelField) {
      isLevelFirstField = frame.fields.indexOf(levelField) === 0;
    }

    for (const [fieldIndex, field] of frame.fields.entries()) {
      const protectedColumn = field.values.some((value) =>
        typeof value === 'string'
          ? containsProtectedLogValue(value)
          : value && typeof value === 'object' && Object.values(value).some((item) => typeof item === 'string' && containsProtectedLogValue(item))
      );
      const category = protectedColumn ? inferLogFieldCategory(sourceFrame ?? extractedFrame, field.name) : undefined;
      const isFirstField = (!isLevelFirstField && fieldIndex === 0) || (isLevelFirstField && fieldIndex === 1);
      // Deep-merge so panel defaults (e.g. custom.filterable) survive when the field already has custom.* from applyFieldOverrides.
      const baseConfig = merge({}, fieldConfig.defaults, field.config);

      const levelEnhancements = getLogLevelColumnEnhancements(field, levelFieldName, baseConfig);

      const configAfterLevel = {
        ...baseConfig,
        ...(levelEnhancements?.mappings ? { mappings: levelEnhancements.mappings } : {}),
        custom: {
          ...baseConfig.custom,
          ...(levelEnhancements?.cellOptions ? { cellOptions: levelEnhancements.cellOptions } : {}),
          ...(levelEnhancements?.width !== undefined ? { width: levelEnhancements.width } : {}),
        },
      };

      // We are mutating fields. Would it be possible to avoid it?
      if (configAfterLevel.custom?.cellOptions?.cellComponent) {
        configAfterLevel.custom.cellOptions = undefined;
      }

      field.config = {
        ...configAfterLevel,
        filterable: !protectedColumn && (field.config?.filterable ?? doesFieldSupportAdHocFiltering(field, timeFieldName, bodyFieldName)),
        custom: {
          ...configAfterLevel.custom,
          width:
            field.name === timeFieldName
              ? getTimeFieldWidth(configAfterLevel.custom?.width, fieldIndex, options)
              : configAfterLevel.custom?.width,
          inspect: !protectedColumn && (configAfterLevel.custom?.inspect ?? doesFieldSupportInspector(field)),
          ...(field.name === timeFieldName && timeColumnHeaderTooltip
            ? { headerTooltip: timeColumnHeaderTooltip }
            : {}),
          cellOptions:
            isFirstField && bodyFieldName && (supportsPermalink || options.enableLogDetails)
              ? {
                  type: TableCellDisplayMode.Custom,
                  cellComponent: (cellProps: CustomCellRendererProps) => (
                    <LogsTableCustomCellRenderer
                      category={category}
                      logsFrame={logsFrame}
                      supportsPermalink={supportsPermalink}
                      cellProps={cellProps}
                      options={options}
                      buildLinkToLog={
                        isBuildLinkToLogLine(options.buildLinkToLogLine) ? options.buildLinkToLogLine : onPermalinkClick
                      }
                    />
                  ),
                }
              : protectedColumn
                ? {
                    type: TableCellDisplayMode.Custom,
                    cellComponent: (cellProps: CustomCellRendererProps) => (
                      <ProtectedLogsTableCell {...cellProps} isBody={field.name === bodyFieldName} category={category} />
                    ),
                  }
                : configAfterLevel.custom?.cellOptions,
        },
      };
    }
  }

  return organizedFrame[0];
};

import { createDataFrame } from '@grafana/data';

import { DEFAULT_SPAN_FILTERS } from '../../state/constants';
import { filterSpans } from '../components/utils/filter-spans';

import { traceForDisplay, transformDataFrames, transformTraceDataFrame } from './transform';

describe('transformTraceDataFrame()', () => {
  const fields = [
    { name: 'traceID', values: ['trace1'] },
    { name: 'operationName', values: ['operation1'] },
    { name: 'kind', values: ['server'] },
    { name: 'tags', values: [[{ key: 'key1', value: 'value1' }]] },
  ];

  it('should return transformed data', () => {
    const dummyDataFrame = createDataFrame({
      fields: fields.concat([...fields, { name: 'spanID', values: ['span1'] }]),
    });
    expect(transformTraceDataFrame(dummyDataFrame)).toEqual({
      processes: { span1: { serviceName: undefined, serviceNamespace: undefined, tags: [] } },
      spans: [
        {
          dataFrameRowIndex: 0,
          duration: NaN,
          flags: 0,
          kind: 'server',
          logs: [],
          operationName: 'operation1',
          processID: 'span1',
          references: [],
          spanID: 'span1',
          startTime: NaN,
          tags: [{ key: 'key1', value: 'value1' }],
          traceID: 'trace1',
        },
      ],
      traceID: 'trace1',
    });
  });

  it('should return null for any span without a spanID', () => {
    const dummyDataFrame = createDataFrame({
      fields: fields,
    });
    expect(transformTraceDataFrame(dummyDataFrame)).toEqual(null);
  });

  it('should map serviceNamespace from DataFrame into process when present', () => {
    const frameWithNamespace = createDataFrame({
      fields: [
        { name: 'traceID', values: ['trace1'] },
        { name: 'spanID', values: ['span1'] },
        { name: 'operationName', values: ['GET /api'] },
        { name: 'serviceName', values: ['cart-service'] },
        { name: 'serviceNamespace', values: ['production'] },
        { name: 'kind', values: ['server'] },
        { name: 'tags', values: [[]] },
      ],
    });
    const result = transformTraceDataFrame(frameWithNamespace);
    expect(result).not.toBeNull();
    expect(result!.processes['span1']).toEqual({
      serviceName: 'cart-service',
      serviceNamespace: 'production',
      tags: [],
    });
  });
});

describe('traceForDisplay()', () => {
  it('omits only Tempo span blind indexes without changing raw span tags, resources, or other traces', () => {
    const frame = createDataFrame({
      fields: [
        { name: 'traceID', values: ['trace1'] },
        { name: 'spanID', values: ['span1'] },
        { name: 'operationName', values: ['operation1'] },
        { name: 'serviceName', values: ['api'] },
        { name: 'startTime', values: [10] },
        { name: 'duration', values: [2] },
        {
          name: 'tags',
          values: [
            [
              { key: 'bi.secret', value: ['bi:v1:11111111111111111111111111111111:abc'] },
              { key: 'enc.secret', value: 'enc:v1:11111111111111111111111111111111:ciphertext' },
              { key: 'biography', value: 'visible' },
            ],
          ],
        },
        { name: 'serviceTags', values: [[{ key: 'bi.resource', value: 'resource' }]] },
        { name: 'logs', values: [[{ timestamp: 10, fields: [{ key: 'bi.event', value: 'event' }] }]] },
      ],
    });
    // The frame is the source of truth; the display model must not change it.
    const trace = transformDataFrames(frame)!;
    const display = traceForDisplay(trace, 'tempo');

    expect(display.spans[0].tags.map((tag) => tag.key)).toEqual(expect.arrayContaining(['enc.secret', 'biography']));
    expect(display.spans[0].tags).toHaveLength(2);
    expect(display.spans[0].process.tags?.map((tag) => tag.key)).toEqual(['bi.resource']);
    expect(display.spans[0].logs?.[0].fields.map((tag) => tag.key)).toEqual(['bi.event']);
    expect(trace.spans[0].tags).toHaveLength(3);
    expect(frame.fields.find((field) => field.name === 'tags')?.values[0]).toEqual([
      { key: 'bi.secret', value: ['bi:v1:11111111111111111111111111111111:abc'] },
      { key: 'enc.secret', value: 'enc:v1:11111111111111111111111111111111:ciphertext' },
      { key: 'biography', value: 'visible' },
    ]);
    expect(traceForDisplay(trace, 'jaeger')).toBe(trace);
    const search = {
      ...DEFAULT_SPAN_FILTERS,
      adhocFilters: [{ key: '_textSearch_', operator: '=', value: 'bi.secret' }],
    };
    expect(filterSpans(search, trace.spans)).toEqual(new Set(['span1']));
    expect(filterSpans(search, display.spans)).toEqual(new Set());
  });
});

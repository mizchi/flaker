import Ajv2020Module from "ajv/dist/2020.js";

// ajv ships CJS; under ESM the class is either the module or its default.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as new (
  opts: Record<string, unknown>,
) => { compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown } };

/**
 * `date-time` as flaker emits it (Date#toISOString: UTC, ending in Z). Written
 * here instead of pulling in ajv-formats for the one format the contracts use.
 */
const DATE_TIME = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));

export function validator(schema: object) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, formats: { "date-time": DATE_TIME } });
  const validate = ajv.compile(schema);
  return (data: unknown): string | null => (validate(data) ? null : JSON.stringify(validate.errors));
}

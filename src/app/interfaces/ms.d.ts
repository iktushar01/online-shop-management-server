declare module "ms" {
  export type StringValue = string;

  export interface Options {
    long?: boolean;
  }

  function ms(val: string | number, options?: Options): number;
  export default ms;
}

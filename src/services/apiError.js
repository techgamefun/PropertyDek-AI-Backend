export class ApiError extends Error {
  constructor(code, statusCode, message, fields) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

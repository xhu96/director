import { describe, expect, test } from "vitest";
import {
  AppError,
  ErrorCode,
  isAppError,
  isAppErrorWithCode,
  isExpressError,
} from "./error";

describe("errors", () => {
  describe("AppError", () => {
    test("should have the correct properties when thrown", () => {
      try {
        throw new AppError(ErrorCode.NOT_FOUND, "Could not find something", {
          foo: "bar",
        });
      } catch (error) {
        expect(isAppError(error)).toBe(true);
        const managedError = error as AppError;
        expect(managedError.name).toBe("AppError");
        expect(managedError.props).toEqual({ foo: "bar" });
        expect(managedError.code).toBe(ErrorCode.NOT_FOUND);
        expect(managedError.message).toBe("Could not find something");
      }
    });

    test("should work with empty props object", () => {
      const error = new AppError(ErrorCode.UNAUTHORIZED, "Not logged in");
      expect(error.props).toEqual({});
      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    test("should preserve stack trace", () => {
      const error = new AppError(ErrorCode.TIMEOUT, "Request timed out");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("AppError");
    });
  });

  describe("isAppError", () => {
    test("returns true for AppError instances", () => {
      const error = new AppError(ErrorCode.NOT_FOUND, "Not found");
      expect(isAppError(error)).toBe(true);
    });

    test("returns false for standard Error", () => {
      const error = new Error("Regular error");
      expect(isAppError(error)).toBe(false);
    });

    test("returns false for null/undefined", () => {
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
    });

    test("returns false for non-error objects", () => {
      expect(isAppError({ message: "fake error" })).toBe(false);
      expect(isAppError("string error")).toBe(false);
      expect(isAppError(42)).toBe(false);
    });
  });

  describe("isAppErrorWithCode", () => {
    test("returns true when error has matching code", () => {
      const error = new AppError(ErrorCode.FORBIDDEN, "Access denied");
      expect(isAppErrorWithCode(error, ErrorCode.FORBIDDEN)).toBe(true);
    });

    test("returns false when error has different code", () => {
      const error = new AppError(ErrorCode.FORBIDDEN, "Access denied");
      expect(isAppErrorWithCode(error, ErrorCode.UNAUTHORIZED)).toBe(false);
    });

    test("returns false for non-AppError", () => {
      const error = new Error("Regular error");
      expect(isAppErrorWithCode(error, ErrorCode.NOT_FOUND)).toBe(false);
    });

    test("returns false for null/undefined", () => {
      expect(isAppErrorWithCode(null, ErrorCode.NOT_FOUND)).toBe(false);
      expect(isAppErrorWithCode(undefined, ErrorCode.NOT_FOUND)).toBe(false);
    });
  });

  describe("isExpressError", () => {
    test("returns true for error with statusCode", () => {
      const error = Object.assign(new Error("Express error"), {
        statusCode: 404,
      });
      expect(isExpressError(error)).toBe(true);
    });

    test("returns false for error without statusCode", () => {
      const error = new Error("Regular error");
      expect(isExpressError(error)).toBe(false);
    });

    test("returns false when statusCode is not a number", () => {
      const error = Object.assign(new Error("Bad error"), {
        statusCode: "404",
      });
      expect(isExpressError(error)).toBe(false);
    });

    test("returns false for non-error objects", () => {
      expect(isExpressError({ statusCode: 500 })).toBe(false);
      expect(isExpressError(null)).toBe(false);
    });
  });

  describe("ErrorCode enum", () => {
    test("all error codes should be unique", () => {
      const codes = Object.values(ErrorCode);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    test("all error codes should be non-empty strings", () => {
      for (const code of Object.values(ErrorCode)) {
        expect(typeof code).toBe("string");
        expect(code.length).toBeGreaterThan(0);
      }
    });
  });
});

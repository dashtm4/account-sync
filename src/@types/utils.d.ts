export {};

declare global {
    interface String {
        withIndent(): String;
    }
}

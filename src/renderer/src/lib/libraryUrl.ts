/** URL of a file in the app's library, served by the main process over `book://`. */
export function libraryFileUrl(bookId: string, fileName: 'book.pdf' | 'book.epub'): string {
  return `book://library/${bookId}/${fileName}`
}

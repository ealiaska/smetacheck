import { describe, expect, it } from "vitest";
import { importMatrix } from "./importer";

describe("flexible estimate importer", () => {
  it("finds a Russian header below title rows and supplies traceability", () => {
    const matrix = [
      ["Локальная смета"],
      ["Синтетический объект"],
      ["№ п/п", "Наименование работ и затрат", "Ед. изм.", "Объём работ", "Цена за единицу", "Обоснование"],
      ["1", "Монтаж бортового камня", "п.м", "100", "4600", "E27-03"],
      ["2", "Подготовка основания", "м3", "20", "5000", "E11-02"],
    ];
    const result = importMatrix(matrix, "estimate", "estimate-free.xlsx", "Работы");
    expect(result.rows).toHaveLength(2);
    expect(result.report.headerRow).toBe(3);
    expect(result.rows[0]).toMatchObject({ document_id: "estimate-free", position_id: "1", page_or_sheet: "Работы", work_description: "Монтаж бортового камня", unit: "п.м", quantity: "100", unit_price: "4600" });
  });

  it("maps Kazakh AVR column names without canonical headers", () => {
    const matrix = [
      ["Орындалған жұмыстар актісі"],
      ["Реттік нөмір", "Жұмыстардың атауы", "Өлшем бірлігі", "Көлемі", "Бірлік бағасы", "Норматив коды"],
      ["10", "Бордюр тасын орнату", "м", "100", "5600", "E27-03"],
    ];
    const result = importMatrix(matrix, "estimate", "avr-kz.csv", "Sheet1");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ position_id: "10", work_description: "Бордюр тасын орнату", unit: "м", quantity: "100", unit_price: "5600", norm_ref: "E27-03" });
  });

  it("infers useful columns when there is no recognizable header", () => {
    const matrix = [
      ["1", "Устройство монолитного основания", "м3", "12", "18500", "E11-01"],
      ["2", "Установка бордюрного камня", "м", "240", "4600", "E27-03"],
      ["3", "Подготовка песчаного слоя", "м3", "20", "5000", "E11-02"],
    ];
    const result = importMatrix(matrix, "estimate", "unknown.xls", "Лист1");
    expect(result.rows).toHaveLength(3);
    expect(result.report.inferred).toContain("work_description");
    expect(result.rows[0].work_description).toBe("Устройство монолитного основания");
  });
});

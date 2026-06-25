import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { apiGet } from "./api";

export interface BrandInfo {
  id: number;
  name_en: string;
  name_ar: string;
  status: string;
}

interface BrandCtx {
  brands: BrandInfo[];
  selectedBrand: BrandInfo | null;
  selectBrand: (brand: BrandInfo | null) => void;
  isGroupView: boolean;
  setGroupView: (v: boolean) => void;
  refreshBrands: () => Promise<void>;
}

const BrandContext = createContext<BrandCtx>({
  brands: [],
  selectedBrand: null,
  selectBrand: () => {},
  isGroupView: false,
  setGroupView: () => {},
  refreshBrands: async () => {},
});

export const useBrand = () => useContext(BrandContext);

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<BrandInfo[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<BrandInfo | null>(null);
  const [isGroupView, setGroupView] = useState(false);

  const refreshBrands = useCallback(async () => {
    try {
      const data = await apiGet("/api/hr/brands");
      const active = (data as BrandInfo[]).filter((b) => b.status === "active");
      setBrands(active);
    } catch {
      setBrands([]);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    refreshBrands().then(() => {
      const saved = localStorage.getItem("selectedBrandId");
      if (saved) {
        // will be resolved after brands load
      }
    });
  }, [refreshBrands]);

  // Resolve saved brand after brands load
  useEffect(() => {
    if (brands.length === 0) return;
    const saved = localStorage.getItem("selectedBrandId");
    if (saved === "group") {
      setGroupView(true);
      setSelectedBrand(null);
    } else if (saved) {
      const found = brands.find((b) => b.id === Number(saved));
      if (found) {
        setSelectedBrand(found);
        setGroupView(false);
      }
    } else if (brands.length === 1) {
      // Auto-select the only brand
      setSelectedBrand(brands[0]);
      localStorage.setItem("selectedBrandId", String(brands[0].id));
    }
  }, [brands]);

  const selectBrand = (brand: BrandInfo | null) => {
    setSelectedBrand(brand);
    setGroupView(false);
    if (brand) {
      localStorage.setItem("selectedBrandId", String(brand.id));
    } else {
      localStorage.removeItem("selectedBrandId");
    }
  };

  const handleSetGroupView = (v: boolean) => {
    setGroupView(v);
    if (v) {
      setSelectedBrand(null);
      localStorage.setItem("selectedBrandId", "group");
    }
  };

  return (
    <BrandContext.Provider
      value={{
        brands,
        selectedBrand,
        selectBrand,
        isGroupView,
        setGroupView: handleSetGroupView,
        refreshBrands,
      }}
    >
      {children}
    </BrandContext.Provider>
  );
}

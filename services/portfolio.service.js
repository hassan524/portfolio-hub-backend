// services/portfolio.service.js

import { supabase } from "../config/db.js";

export const createPortfolioService = async ({
    userId,
    saveMode,
    name,
    description,
    templateId,
    siteData,
}) => {
    const isDraft = saveMode === "draft";

    const { data, error } = await supabase
        .from("portfolios")
        .insert({
            userid: userId,
            name,
            description,
            templateid: templateId,
            sitedata: siteData,
            isdraft: isDraft,
            isdeployed: !isDraft,
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
};
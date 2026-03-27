#!/usr/bin/env python3
"""
北京到手薪资计算器
基于2025-2026年度北京社保/公积金政策及中国个人所得税法
"""

import argparse
import json
import math
import sys

# ========== 政策参数 ==========

# 社保缴费基数上下限（2025.7 - 2026.6）
SOCIAL_BASE_UPPER = 35811
SOCIAL_BASE_LOWER = 7162

# 公积金缴费基数上下限
HF_BASE_UPPER = 35811
HF_BASE_LOWER = 2540

# 个人社保缴纳比例（北京）
PENSION_RATE = 0.08       # 养老保险
MEDICAL_RATE = 0.02       # 医疗保险
UNEMPLOYMENT_RATE = 0.005 # 失业保险
MEDICAL_EXTRA = 3         # 大额互助（固定金额/月）

SOCIAL_PERSONAL_RATE = PENSION_RATE + MEDICAL_RATE + UNEMPLOYMENT_RATE  # 10.5%

# 单位社保缴纳比例（仅供展示）
UNIT_PENSION_RATE = 0.16
UNIT_MEDICAL_RATE = 0.095  # 含生育
UNIT_UNEMPLOYMENT_RATE = 0.005
UNIT_INJURY_RATE = 0.002   # 工伤，行业不同

# 个税免征额
TAX_THRESHOLD = 5000  # 元/月

# 综合所得年度税率表（七级超额累进）
ANNUAL_TAX_BRACKETS = [
    (36000,   0.03, 0),
    (144000,  0.10, 2520),
    (300000,  0.20, 16920),
    (420000,  0.25, 31920),
    (660000,  0.30, 52920),
    (960000,  0.35, 85920),
    (float('inf'), 0.45, 181920),
]

# 年终奖月度税率表（单独计税）
BONUS_MONTHLY_BRACKETS = [
    (3000,    0.03, 0),
    (12000,   0.10, 210),
    (25000,   0.20, 1410),
    (35000,   0.25, 2660),
    (55000,   0.30, 4410),
    (80000,   0.35, 7160),
    (float('inf'), 0.45, 15160),
]


def clamp(value, lower, upper):
    """将值限制在上下限范围内"""
    return max(lower, min(upper, value))


def calc_social_insurance_personal(base):
    """计算个人社保月缴纳额"""
    actual_base = clamp(base, SOCIAL_BASE_LOWER, SOCIAL_BASE_UPPER)
    pension = round(actual_base * PENSION_RATE, 2)
    medical = round(actual_base * MEDICAL_RATE, 2)
    unemployment = round(actual_base * UNEMPLOYMENT_RATE, 2)
    total = round(pension + medical + unemployment + MEDICAL_EXTRA, 2)
    return {
        "actual_base": actual_base,
        "pension": pension,
        "medical": medical,
        "unemployment": unemployment,
        "medical_extra": MEDICAL_EXTRA,
        "total": total,
    }


def calc_housing_fund_personal(base, rate):
    """计算个人公积金月缴纳额"""
    actual_base = clamp(base, HF_BASE_LOWER, HF_BASE_UPPER)
    personal = round(actual_base * rate, 2)
    # 公积金月缴存额上限（基数上限 × 12%）
    max_personal = round(HF_BASE_UPPER * 0.12, 2)
    personal = min(personal, max_personal)
    return {
        "actual_base": actual_base,
        "rate": rate,
        "personal": personal,
        "unit": personal,  # 单位与个人相同
    }


def get_annual_tax(taxable_income):
    """根据全年应纳税所得额计算个税"""
    if taxable_income <= 0:
        return 0, 0, 0
    for upper, rate, quick_deduction in ANNUAL_TAX_BRACKETS:
        if taxable_income <= upper:
            tax = round(taxable_income * rate - quick_deduction, 2)
            return max(tax, 0), rate, quick_deduction
    return 0, 0, 0


def calc_bonus_tax_separate(bonus):
    """年终奖单独计税"""
    if bonus <= 0:
        return {"tax": 0, "after_tax": 0, "rate": 0, "quick_deduction": 0}
    monthly_avg = bonus / 12
    for upper, rate, qd in BONUS_MONTHLY_BRACKETS:
        if monthly_avg <= upper:
            tax = round(bonus * rate - qd, 2)
            return {
                "tax": max(tax, 0),
                "after_tax": round(bonus - max(tax, 0), 2),
                "rate": rate,
                "quick_deduction": qd,
                "monthly_avg": round(monthly_avg, 2),
            }
    return {"tax": 0, "after_tax": 0, "rate": 0, "quick_deduction": 0}


def calc_monthly_tax_progressive(monthly_salary, social_deduction, hf_deduction, special_deduction):
    """
    使用累计预扣法计算12个月的逐月个税
    """
    months = []
    cumulative_income = 0
    cumulative_threshold = 0
    cumulative_social = 0
    cumulative_hf = 0
    cumulative_special = 0
    cumulative_tax_paid = 0

    for month in range(1, 13):
        cumulative_income += monthly_salary
        cumulative_threshold += TAX_THRESHOLD
        cumulative_social += social_deduction
        cumulative_hf += hf_deduction
        cumulative_special += special_deduction

        cumulative_taxable = (cumulative_income 
                              - cumulative_threshold 
                              - cumulative_social 
                              - cumulative_hf 
                              - cumulative_special)

        cumulative_tax_due, rate, qd = get_annual_tax(cumulative_taxable)
        current_month_tax = round(max(cumulative_tax_due - cumulative_tax_paid, 0), 2)
        cumulative_tax_paid += current_month_tax

        take_home = round(monthly_salary - social_deduction - hf_deduction - current_month_tax, 2)

        months.append({
            "month": month,
            "gross": monthly_salary,
            "social_deduction": social_deduction,
            "hf_deduction": hf_deduction,
            "taxable_income_cumulative": round(max(cumulative_taxable, 0), 2),
            "tax_rate": rate,
            "tax_this_month": current_month_tax,
            "tax_cumulative": round(cumulative_tax_paid, 2),
            "take_home": take_home,
        })

    return months


def main():
    parser = argparse.ArgumentParser(description="北京到手薪资计算器")
    parser.add_argument("--monthly-salary", type=float, required=True, help="税前月薪（元）")
    parser.add_argument("--annual-bonus", type=float, default=0, help="年终奖（元），默认0")
    parser.add_argument("--social-base", type=float, default=None, help="社保缴费基数，默认=月薪")
    parser.add_argument("--housing-fund-base", type=float, default=None, help="公积金缴费基数，默认=月薪")
    parser.add_argument("--housing-fund-rate", type=float, default=0.12, help="公积金缴存比例，默认0.12")
    parser.add_argument("--special-deduction", type=float, default=0, help="专项附加扣除合计（元/月），默认0")
    
    args = parser.parse_args()

    salary = args.monthly_salary
    bonus = args.annual_bonus
    social_base = args.social_base if args.social_base else salary
    hf_base = args.housing_fund_base if args.housing_fund_base else salary
    hf_rate = args.housing_fund_rate
    special = args.special_deduction

    # 1. 计算五险一金
    social = calc_social_insurance_personal(social_base)
    hf = calc_housing_fund_personal(hf_base, hf_rate)
    
    total_deduction_monthly = round(social["total"] + hf["personal"], 2)

    # 2. 逐月计算个税（累计预扣法）
    monthly_details = calc_monthly_tax_progressive(
        salary, social["total"], hf["personal"], special
    )

    total_tax_year = monthly_details[-1]["tax_cumulative"]
    total_take_home_salary = round(sum(m["take_home"] for m in monthly_details), 2)

    # 3. 年终奖计税（如有）
    bonus_result = None
    bonus_combined_result = None
    
    if bonus > 0:
        # 方案一：单独计税
        bonus_result = calc_bonus_tax_separate(bonus)
        
        # 方案二：并入综合所得
        annual_taxable_without_bonus = monthly_details[-1]["taxable_income_cumulative"]
        annual_taxable_with_bonus = annual_taxable_without_bonus + bonus
        
        tax_with_bonus, rate_with, qd_with = get_annual_tax(annual_taxable_with_bonus)
        tax_without_bonus = total_tax_year
        bonus_tax_if_combined = round(max(tax_with_bonus - tax_without_bonus, 0), 2)
        
        bonus_combined_result = {
            "tax": bonus_tax_if_combined,
            "after_tax": round(bonus - bonus_tax_if_combined, 2),
            "annual_taxable_with_bonus": round(annual_taxable_with_bonus, 2),
            "rate": rate_with,
        }

    # 4. 汇总
    annual_take_home_total = total_take_home_salary
    bonus_take_home = 0
    recommended_bonus_method = None
    
    if bonus > 0:
        if bonus_result["tax"] <= bonus_combined_result["tax"]:
            recommended_bonus_method = "单独计税"
            bonus_take_home = bonus_result["after_tax"]
        else:
            recommended_bonus_method = "并入综合所得"
            bonus_take_home = bonus_combined_result["after_tax"]
        annual_take_home_total = round(total_take_home_salary + bonus_take_home, 2)

    # 检查年终奖是否接近临界值
    bonus_warning = None
    if bonus > 0:
        thresholds = [36000, 144000, 300000, 420000, 660000, 960000]
        for t in thresholds:
            if 0 < bonus - t <= 1000:
                bonus_warning = f"⚠️ 您的年终奖 {bonus} 元刚超过 {t} 元临界点，可能导致税率跳档，多交较多个税。建议与HR沟通是否可调整至 {t} 元。"
                break

    result = {
        "input": {
            "monthly_salary": salary,
            "annual_bonus": bonus,
            "social_base_input": social_base,
            "housing_fund_base_input": hf_base,
            "housing_fund_rate": hf_rate,
            "special_deduction_monthly": special,
        },
        "social_insurance": social,
        "housing_fund": hf,
        "monthly_deduction_total": total_deduction_monthly,
        "monthly_details": monthly_details,
        "annual_summary": {
            "gross_salary_annual": round(salary * 12, 2),
            "social_insurance_annual": round(social["total"] * 12, 2),
            "housing_fund_annual": round(hf["personal"] * 12, 2),
            "tax_annual_salary": total_tax_year,
            "take_home_salary_annual": total_take_home_salary,
            "annual_bonus": bonus,
        },
        "policy_info": {
            "social_base_range": f"{SOCIAL_BASE_LOWER} - {SOCIAL_BASE_UPPER} 元",
            "hf_base_range": f"{HF_BASE_LOWER} - {HF_BASE_UPPER} 元",
            "tax_threshold": f"{TAX_THRESHOLD} 元/月",
            "policy_period": "2025年7月 - 2026年6月",
        }
    }

    if bonus > 0:
        result["bonus_separate"] = bonus_result
        result["bonus_combined"] = bonus_combined_result
        result["bonus_recommendation"] = {
            "recommended_method": recommended_bonus_method,
            "tax_saving": round(abs(bonus_result["tax"] - bonus_combined_result["tax"]), 2),
            "take_home_bonus": bonus_take_home,
        }
        if bonus_warning:
            result["bonus_warning"] = bonus_warning

    result["total_annual_take_home"] = annual_take_home_total

    # 输出
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
